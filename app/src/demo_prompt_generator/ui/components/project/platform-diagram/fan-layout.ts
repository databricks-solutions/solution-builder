/**
 * platform-diagram/fan-layout — the edge fan-out geometry, computed for ALL
 * edges AT ONCE (O(E)) and cached, instead of per-edge (which was O(E²) per
 * store tick during a drag: every FlowEdge's useStore selector re-scanned the
 * whole edge list + both-endpoint rects).
 *
 * `computeFanLayout(edges, nodeLookup)` returns a Map<edgeId, FanEntry>. It's
 * memoized on a cheap signature of the inputs (edge endpoints + each node's
 * position/size), so the E FlowEdge selectors that call it within one store
 * tick share ONE computation + E O(1) lookups. Pure — no React, no ReactFlow
 * context; it only reads the plain rect/side helpers from edge-routing.
 */
import {
  type Side,
  type Rect,
  type HandleBound,
  sidePoint,
  spreadFrac,
  endSide,
  anchorRectOf,
  anchorFromBounds,
} from "./edge-routing";
import { portAnchor } from "./composite-lakeflow";
import {
  type EdgeShape,
  drawnPath,
  pathToPolyline,
  flattenPath,
  partitionNodes,
  tilesCrossed,
  titleStripOf,
  turnClearY,
} from "./edges/edge-geometry";

/** A named port anchor for an edge end: prefer ReactFlow's MEASURED handle
 *  bounds (ground truth — works for ANY composite's custom handles with zero
 *  per-handle config), fall back to the hand-tuned `portAnchor` table. Only
 *  consulted for non-plain-side handles (a `t/r/b/l` handle keeps the fan). */
function resolvePort(
  bounds: HandleBound[] | null | undefined,
  handleId: string | null | undefined,
  w: number,
  h: number,
): { side: Side; frac: number } | null {
  if (handleId && ["t", "r", "b", "l"].includes(handleId)) return null;
  return anchorFromBounds(bounds, handleId, w, h) ?? portAnchor(handleId);
}

export interface FanEntry {
  sSide: Side;
  tSide: Side;
  sFrac: number;
  tFrac: number;
  centerX: number | undefined;
  /** Elbow Y of a top/bottom-to-top/bottom fan-out edge (see `assignFanOutElbows`). */
  centerY?: number;
  /** For a same-side U-turn (b→b / t→t): the y its run must clear (see `turnClearY`). */
  turnY?: number;
}

/** Minimal shape of a ReactFlow edge we read (source/target + handles). */
interface FanEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Read only by the tile-avoidance pass, to build the path actually drawn. */
  data?: { shape?: EdgeShape; centerX?: number } | null;
}
/** Minimal shape of ReactFlow's internal node (from `s.nodeLookup`). */
interface FanNode {
  internals: {
    positionAbsolute: { x: number; y: number };
    handleBounds?: { source?: HandleBound[] | null; target?: HandleBound[] | null } | null;
  };
  measured: { width?: number; height?: number };
  /** The logo annotation fields the ANCHOR rect needs (`anchorRectOf` → the icon
   *  sub-rect for a captioned logo) + captioned-logo detection. Optional so the
   *  offline probe's faked lookup and existing callers keep type-checking. */
  data?: { annotation?: { variant?: string; caption?: "right" | "left" | "top" | "bottom" | "side" | "below"; text?: string; fontSize?: number; showDesc?: boolean; desc?: string } };
}

/** Is this node a `logo` annotation WITH a caption — the one node kind whose rect
 *  is inflated past its icon, so its edge anchor uses the ICON sub-rect
 *  (`anchorRectOf`/`logoAnchorPoint`) rather than the full box. Folded into the
 *  layout cache signature so toggling a caption re-anchors. */
export function isCaptionedLogo(n: FanNode | undefined): boolean {
  const a = n?.data?.annotation;
  return a?.variant === "logo" && !!a.text;
}
type NodeLookup = Map<string, FanNode>;

// --- 1-deep memo cache -----------------------------------------------------
// The layout depends only on (edge endpoints/handles) + (each node's rect).
// During a drag, `edges` keeps the same array ref but node positions change,
// so we key on a signature that folds in both. Computing the signature is O(E)
// + O(N); the heavy grouping/sort work then runs once and is reused by every
// edge in the same tick.
let cacheSig = "";
let cacheMap: Map<string, FanEntry> = new Map();

function signature(
  edges: FanEdge[],
  nodeLookup: NodeLookup,
): string {
  let s = "";
  for (const e of edges) {
    // `shape` + `centerX` are folded in because the tile-avoidance pass reads them
    // to rebuild the drawn path — without them, changing an edge's shape or
    // dragging its elbow would leave a stale avoidance decision cached.
    s += `${e.id}:${e.source}>${e.target}:${e.sourceHandle ?? ""}/${e.targetHandle ?? ""}`
      + `:${e.data?.shape ?? ""}:${e.data?.centerX ?? ""};`;
  }
  s += "|";
  // EVERY node, not just the edge endpoints. The tile-avoidance pass treats all
  // tiles as obstacles, so moving (or adding) a node that has no edges of its own
  // still changes the routing — keying only on endpoints would serve a stale route
  // when the user drags an obstacle out from under a line.
  {
    for (const nid of nodeLookup.keys()) {
      const n = nodeLookup.get(nid);
      if (!n) continue;
      const p = n.internals.positionAbsolute;
      s += `${nid}:${Math.round(p.x)},${Math.round(p.y)},${n.measured.width ?? 0}x${n.measured.height ?? 0}`;
      // Fold in the source-handle bounds (id@y) so a re-measure of custom ports
      // — e.g. after toggling a fork option — busts the cache even if the node
      // rect is unchanged. Cheap: a handful of handles per node.
      const hb = n.internals.handleBounds?.source;
      if (hb) for (const h of hb) s += `~${h.id}@${Math.round(h.y)}`;
      // Fold in captioned-logo-ness: it selects whether an end anchors to the ICON
      // sub-rect (anchorRectOf/logoAnchorPoint) vs the full box, so editing a logo's
      // caption to/from empty changes the resolved anchors and must bust the cache.
      if (isCaptionedLogo(n)) s += "~cl";
      s += ";";
    }
  }
  return s;
}

/** Compute (or return cached) fan entries for every edge. */
export function computeFanLayout(
  edges: FanEdge[],
  nodeLookup: NodeLookup,
): Map<string, FanEntry> {
  // NOTE: we intentionally do NOT short-circuit on input IDENTITY
  // (edges===last && nodeLookup===last). In @xyflow/react v12 the store's
  // `nodeLookup` Map is created ONCE and mutated in place (adoptUserNodes clears
  // + repopulates the same Map), and `edges` keeps its reference across a whole
  // node drag — so an identity check would be TRUE every tick and freeze the fan
  // geometry mid-drag. The signature (which folds in node positions) is the
  // correct, cheap-enough invalidator; every FlowEdge selector rebuilds the O(E)
  // string per tick but the heavy grouping/sort work is shared via the sig memo.
  const sig = signature(edges, nodeLookup);
  if (sig === cacheSig) return cacheMap;

  // The edge-anchor rect: the ICON sub-rect for a captioned logo (so lines meet the
  // icon, matching the render), the node box otherwise. Used for anchors, the drawn
  // path, AND tile-obstacle bounds — a logo's caption whitespace is not an obstacle,
  // so anchoring and avoidance both see the icon, and the render agrees (all use
  // `anchorRectOf`).
  const rect = (nid: string): Rect | null => {
    const n = nodeLookup.get(nid);
    return n ? anchorRectOf(n as never) : null;
  };
  // Measured source-handle bounds for a node (ground truth for custom handle
  // positions). Node-local coords; sized by `measured`.
  const boundsOf = (nid: string): HandleBound[] | null =>
    nodeLookup.get(nid)?.internals?.handleBounds?.source ?? null;
  const sizeOf = (nid: string): { w: number; h: number } => {
    const n = nodeLookup.get(nid);
    return { w: n?.measured.width ?? 0, h: n?.measured.height ?? 0 };
  };
  const portOf = (nid: string, handleId: string | null | undefined) => {
    const { w, h } = sizeOf(nid);
    return resolvePort(boundsOf(nid), handleId, w, h);
  };
  const sideForEnd = (e: FanEdge, end: "source" | "target"): Side | null => {
    const selfR = rect(end === "source" ? e.source : e.target);
    const otherR = rect(end === "source" ? e.target : e.source);
    if (!selfR || !otherR) return null;
    const oc = { x: otherR.x + otherR.w / 2, y: otherR.y + otherR.h / 2 };
    return endSide(selfR, end === "source" ? e.sourceHandle : e.targetHandle, oc);
  };

  // Group key = nodeId|side (or nodeId|port). For each edge end, remember the
  // OTHER endpoint's center along the side's perpendicular axis, so sorting a
  // group orders the fan to follow the other tiles' positions (no crossings),
  // and re-sorts live as nodes drag.
  const groups = new Map<string, { id: string; key: number }[]>();
  for (const e of edges) {
    for (const end of ["source", "target"] as const) {
      const side = sideForEnd(e, end);
      if (!side) continue;
      const nid = end === "source" ? e.source : e.target;
      const otherR = rect(end === "source" ? e.target : e.source);
      if (!otherR) continue;
      const sortKey =
        side === "l" || side === "r"
          ? otherR.y + otherR.h / 2
          : otherR.x + otherR.w / 2;
      const handle = end === "source" ? e.sourceHandle : e.targetHandle;
      // A handle counts as a distinct PORT (own group, no side-fan) when it
      // resolves to a fixed anchor (measured bounds or the hand-tuned table).
      const port = portOf(nid, handle) ? handle : null;
      const key = port ? `${nid}|${port}` : `${nid}|${side}`;
      const arr = groups.get(key) ?? [];
      arr.push({ id: e.id, key: sortKey });
      groups.set(key, arr);
    }
  }
  // Pre-sort each group ONCE (was re-sorted per edge lookup before).
  const sortedGroups = new Map<string, { id: string; key: number }[]>();
  for (const [k, arr] of groups) {
    sortedGroups.set(k, arr.slice().sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1)));
  }
  const idxIn = (key: string, id: string): { i: number; n: number } => {
    const arr = sortedGroups.get(key) ?? [];
    return { i: arr.findIndex((x) => x.id === id), n: arr.length };
  };

  // Fan multiple edges around a fixed named-port anchor `base`. Gap is DYNAMIC:
  // starts at 0.06 and shrinks as more edges share the port so they stay inside
  // [0.05, 0.95] without piling on the clamp. `base` is often off-centre (e.g.
  // in-lakeflow-connect at 0.17), so the fit is bounded by the TIGHTER side's room
  // — the fan reaches at most `half` each way and still fits `n` lines.
  const portFan = (base: number, i: number, n: number) => {
    if (n <= 1) return base;
    const half = Math.min(base - 0.05, 0.95 - base); // room on the tighter side
    const gap = Math.min(0.06, (2 * half) / (n - 1));
    return Math.min(0.95, Math.max(0.05, base + (i - (n - 1) / 2) * gap));
  };

  const out = new Map<string, FanEntry>();
  // Vertical elbow of each horizontal-run edge: its effective x + Y-extent (+
  // source-anchor Y and target direction), used by the de-overlap pass after the
  // main loop.
  const vertSpans = new Map<string, { y0: number; y1: number; effX: number; sy: number; toTarget: number; hasCenter: boolean }>();
  for (const e of edges) {
    const sR = rect(e.source);
    const tR = rect(e.target);
    if (!sR || !tR) continue;
    const sCtr = { x: sR.x + sR.w / 2, y: sR.y + sR.h / 2 };
    const tCtr = { x: tR.x + tR.w / 2, y: tR.y + tR.h / 2 };
    const ss = endSide(sR, e.sourceHandle, tCtr);
    const ts = endSide(tR, e.targetHandle, sCtr);
    const sPort = portOf(e.source, e.sourceHandle);
    const tPort = portOf(e.target, e.targetHandle);
    const sg = idxIn(sPort ? `${e.source}|${e.sourceHandle}` : `${e.source}|${ss}`, e.id);
    const tg = idxIn(tPort ? `${e.target}|${e.targetHandle}` : `${e.target}|${ts}`, e.id);

    const tEndSide = tPort?.side ?? ts;
    const tFrac = tPort ? portFan(tPort.frac, tg.i < 0 ? 0 : tg.i, tg.n) : spreadFrac(tg.i < 0 ? 0 : tg.i, tg.n);
    let centerX: number | undefined;
    // The source side (as resolved for this edge) — needed to bound the corridor
    // the vertical elbow lives in.
    const sEndSide = sPort?.side ?? ss;
    if (
      tg.n > 1 &&
      (tEndSide === "l" || tEndSide === "r") &&
      (sEndSide === "l" || sEndSide === "r")
    ) {
      // Rank against the connector's FIXED center Y (same reference for every
      // sibling) — NOT this edge's own fanned anchor, which varies per edge and
      // would make two symmetric sources rank identically and collide.
      const connectorY = tPort ? sidePoint(tR, tPort.side, tPort.frac).y : tCtr.y;
      const sibs = sortedGroups.get(tPort ? `${e.target}|${e.targetHandle}` : `${e.target}|${ts}`) ?? [];
      // NESTING RULE — edges from stacked sources converging on ONE target
      // connector must nest like concentric brackets so their vertical elbows
      // never overlap. Rank ALL siblings converging on this connector by DISTANCE
      // from it (nearest = innermost) and give each a distinct X track *inside the
      // actual corridor* between the source exit and the target entry — so the
      // offset ALWAYS fits (no clamp collapse) however narrow the gap, and works
      // for any placement (col/row/at/relational). Every edge gets a UNIQUE track,
      // so no two verticals share an X.
      const ranked = sibs
        .slice()
        // Primary: distance from the connector (nearest = innermost). Tiebreak on
        // signed Y so two EQUIDISTANT sources (one above, one below) still get
        // DISTINCT tracks instead of colliding on the same X.
        .sort((a, b) =>
          Math.abs(a.key - connectorY) - Math.abs(b.key - connectorY) || a.key - b.key,
        );
      const rank = ranked.findIndex((x) => x.id === e.id); // 0 = nearest (innermost)
      const n = ranked.length;
      // Corridor between the source's exit edge and the target's entry edge.
      const srcExitX = sEndSide === "r" ? sR.x + sR.w : sR.x;
      const tgtEntryX = tEndSide === "l" ? tR.x : tR.x + tR.w;
      const MARGIN = 24; // keep elbows off the tile faces + clear of the step stub
      const lo = Math.min(srcExitX, tgtEntryX) + MARGIN;
      const hi = Math.max(srcExitX, tgtEntryX) - MARGIN;
      if (n > 0) {
        // The FARTHER a source is from the connector, the closer its vertical
        // elbow sits to the TARGET (outer bracket) — its long horizontal run
        // wraps AROUND the nearer siblings and its vertical drops in past them,
        // never overlapping. The NEAREST source keeps the shortest, innermost
        // path (elbow toward the source side). `t` = distance to target, (0..1]:
        //   rank 0 (nearest)  → t small  → elbow toward SOURCE
        //   rank n-1 (farthest) → t large → elbow toward TARGET
        const t = (rank + 1) / n;
        const toward = tEndSide === "l" ? 1 : -1; // sign toward the target side
        if (hi > lo) {
          // Enough room: distribute the nested tracks across the real corridor.
          centerX = toward === 1 ? lo + t * (hi - lo) : hi - t * (hi - lo);
        } else {
          // Corridor too narrow (or source overlaps target): fall back to a fixed
          // STEP fan out from the mid-gap so the verticals still never share an X.
          const midX = (srcExitX + tgtEntryX) / 2;
          const STEP = 16;
          centerX = midX + toward * (rank + 1) * STEP;
        }
      }
    }
    out.set(e.id, {
      sSide: sPort?.side ?? ss,
      tSide: tPort?.side ?? ts,
      sFrac: sPort ? portFan(sPort.frac, sg.i < 0 ? 0 : sg.i, sg.n) : spreadFrac(sg.i < 0 ? 0 : sg.i, sg.n),
      tFrac,
      centerX,
    });
    // For any HORIZONTAL-to-HORIZONTAL edge (both ends l/r) record its vertical
    // elbow's EFFECTIVE x (explicit centerX, else the smooth-step default = the
    // midpoint between the two anchor x's) + its Y-extent, so the de-overlap pass
    // can separate even edges that have NO fan centerX of their own.
    if ((sEndSide === "l" || sEndSide === "r") && (tEndSide === "l" || tEndSide === "r")) {
      const sy = sidePoint(sR, sEndSide, out.get(e.id)!.sFrac).y;
      const ty = sidePoint(tR, tEndSide, tFrac).y;
      const sx = sEndSide === "r" ? sR.x + sR.w : sR.x;
      const tx = tEndSide === "l" ? tR.x : tR.x + tR.w;
      vertSpans.set(e.id, {
        y0: Math.min(sy, ty),
        y1: Math.max(sy, ty),
        effX: centerX ?? (sx + tx) / 2,
        sy,        // source-anchor Y (orders which of two colliding verticals is "lower")
        toTarget: Math.sign(tx - sx) || 1, // +1 target is to the right, −1 to the left
        hasCenter: centerX !== undefined,
      });
    }
  }

  // Same-source fan-out nesting. Runs BEFORE the de-overlap pass, which skips every elbow
  // already set (`hasCenter`), so a fan's elbows come from the nesting rule, not the heuristic.
  const fanOwned = assignFanOutElbows(out, edges, rect, vertSpans, [...nodeLookup.keys()]);

  // De-overlap pass — two edges leaving/entering stacked anchors on the same
  // side (e.g. the medallion's `@out-gold` above `@out-mv`, both heading up-right
  // to Genie / the dashboard) can land their vertical elbows on the SAME x with
  // overlapping Y and run parallel/on top of each other. Separate them
  // DIRECTIONALLY by source-anchor order: the LOWER anchor's elbow moves TOWARD
  // its target, the HIGHER anchor's moves AWAY — so the two lines cross cleanly
  // (lower→right, upper→left when the targets are up-right; mirrored otherwise)
  // instead of doubling up. Fan-nested edges (hasCenter) already have a track and
  // are left alone. O(E²) over horizontal-run edges only; cheap in practice.
  const STEP = 12;
  const X_TOL = 6; // elbows within 6px count as "the same vertical line"
  const runs = [...vertSpans.entries()]
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => a.effX - b.effX || a.sy - b.sy);
  for (let i = 0; i < runs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(runs[i].effX - runs[j].effX) > X_TOL) continue; // different column
      if (!(runs[i].y0 <= runs[j].y1 && runs[j].y0 <= runs[i].y1)) continue; // no Y overlap
      // Two overlapping verticals on the same column → split them so they CROSS
      // instead of running parallel: the one whose source anchor is LOWER moves
      // TOWARD its target, the HIGHER one moves AWAY. (Targets up-right ⇒ lower→
      // right, upper→left.) Skip fan-nested edges — they own their track.
      const [lower, higher] = runs[i].sy >= runs[j].sy ? [runs[i], runs[j]] : [runs[j], runs[i]];
      if (!lower.hasCenter) {
        lower.effX += lower.toTarget * STEP;      // lower anchor → toward its target
        out.get(lower.id)!.centerX = lower.effX;
      }
      if (!higher.hasCenter) {
        higher.effX -= higher.toTarget * STEP;    // higher anchor → away from its target
        out.get(higher.id)!.centerX = higher.effX;
      }
    }
  }

  uncrossFanOut(out, edges, rect);

  laneSeparate(out, edges, rect, nodeLookup, fanOwned);

  avoidTiles(out, edges, nodeLookup, rect);

  // A bottom/top-to-same-side loop runs beyond every node it would otherwise cross. Last, so
  // it reads the final sides (avoidTiles may have moved a fraction, never the run it sets).
  const blockers = [...nodeLookup.keys()].map((nid) => rect(nid)).filter((r): r is Rect => !!r && r.w > 0 && r.h > 0);
  for (const e of edges) {
    const f = out.get(e.id);
    const sR = rect(e.source), tR = rect(e.target);
    if (!f || !sR || !tR || f.sSide !== f.tSide) continue;
    const turnY = turnClearY(f.sSide, f.tSide, sidePoint(sR, f.sSide, f.sFrac), sidePoint(tR, f.tSide, f.tFrac), blockers);
    if (turnY !== undefined) f.turnY = turnY;
  }

  cacheSig = sig;
  cacheMap = out;
  return out;
}

// --- same-source fan-out nesting (the elbow order) ---------------------------
// One source side fanning out to several targets beyond it (right side → targets to the
// right, bottom side → targets below, …). Each edge is a STUB out of the side, a RUN that
// turns (the elbow), and a STUB into its target. Two such edges can only cross when one
// edge's run passes through the other's stub or run, so the elbows must NEST.
//
// The rule, for the right side (the other sides are the same with the axes swapped; the
// "normal" axis is the one the stubs run along, the "across" axis is the one the exits are
// spread along; exits are already ordered by their targets, top→bottom / left→right):
//   • two targets BELOW their exits: the HIGHER exit's elbow sits NEARER its target
//     (its vertical has to pass the lower stubs' rows, so it runs outside them);
//   • two targets ABOVE their exits: the LOWER exit's elbow sits NEARER its target (mirror);
//   • mixed: the below group takes the tracks nearest the target, the above group the tracks
//     nearer the source (their spans can only overlap in that order).
// So the tracks are handed out in ONE order counted from the target side:
//   [below group, highest exit first] ++ [above group, lowest exit first].
// Verified by the proper-crossing tests in test-diagram-layout.ts ("fan-out nesting").
//
// The bundle is then placed in the corridor between the two stub clearances, AVOIDING the
// faces of tiles its runs would graze (the same 10px band inspect-arch reports as EDGE
// GRAZES TILE): it takes the largest free stretch of the corridor. Only the normal-axis
// elbow is set (`centerX` for l/r, `centerY` for t/b). Edges with an authored elbow
// (`data.centerX`) or a fan-in track keep theirs.
const FAN_OUT_OPPOSITE: Record<Side, Side> = { t: "b", b: "t", l: "r", r: "l" };
const FAN_OUT_MARGIN = 20;   // keep a track clear of both stubs (guardCenterX/Y clamp the rest)
const FAN_OUT_SPACING = 24;  // widest spacing between two tracks in a fan (a bundle, not a spread)
const FAN_OUT_MIN_GAP = 8;   // tighter than this, a bundle can't read as separate lines
const FAN_OUT_GRAZE = 10;    // tile-face band a run must stay out of (inspect-arch EDGE GRAZES TILE)

/** Free sub-intervals of [lo, hi] once the (possibly overlapping) bands are removed. */
function freeIntervals(lo: number, hi: number, bands: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of bands.slice().sort((p, q) => p[0] - q[0])) {
    if (b <= at) continue;
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
    if (at >= hi) break;
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([a, b]) => b > a);
}

/** Assigns the nested elbows. Returns the ids it owns (laneSeparate must not move their elbows). */
function assignFanOutElbows(
  out: Map<string, FanEntry>,
  edges: FanEdge[],
  rect: (nid: string) => Rect | null,
  vertSpans: Map<string, { effX: number; hasCenter: boolean }>,
  nodeIds: string[],
): Set<string> {
  const owned = new Set<string>();
  // Tiles only: a container box is meant to be crossed (its runs pass through its padding).
  const { tiles } = partitionNodes(
    nodeIds.map((id) => ({ id, r: rect(id) })).filter((n): n is { id: string; r: Rect } => !!n.r && n.r.w > 0 && n.r.h > 0),
  );
  const groups = new Map<string, { e: FanEdge; f: FanEntry }[]>();
  for (const e of edges) {
    const f = out.get(e.id);
    if (!f || e.data?.centerX !== undefined || f.centerX !== undefined) continue;
    if (f.tSide !== FAN_OUT_OPPOSITE[f.sSide]) continue; // horizontal/vertical run only
    const key = `${e.source}|${f.sSide}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ e, f });
  }

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sSide = members[0].f.sSide;
    const horiz = sSide === "l" || sSide === "r";
    const N = horiz ? "x" : "y"; // normal axis (the elbow's coordinate)
    const A = horiz ? "y" : "x"; // across axis (where the exits are spread)
    const dir = sSide === "r" || sSide === "b" ? 1 : -1; // outward from the source

    type Member = { id: string; exit: number; target: number; srcN: number; tgtN: number };
    const valid: Member[] = [];
    for (const { e, f } of members) {
      const sR = rect(e.source), tR = rect(e.target);
      if (!sR || !tR) continue;
      const sp = sidePoint(sR, f.sSide, f.sFrac);
      const tp = sidePoint(tR, f.tSide, f.tFrac);
      if (dir * (tp[N] - sp[N]) <= 0) continue; // target not beyond the exit: no corridor
      valid.push({ id: e.id, exit: sp[A], target: tp[A], srcN: sp[N], tgtN: tp[N] });
    }
    if (valid.length < 2) continue;

    const below = valid.filter((m) => m.target >= m.exit).sort((a, b) => a.exit - b.exit);
    const above = valid.filter((m) => m.target < m.exit).sort((a, b) => b.exit - a.exit);
    const order = [...below, ...above]; // track 0 = nearest the target
    const m = order.length;
    const srcN = order[0].srcN;
    const tgtN = dir > 0
      ? Math.min(...order.map((x) => x.tgtN))
      : Math.max(...order.map((x) => x.tgtN));

    // The corridor between the two stub clearances, and the bands tiles put across it.
    const cLo = Math.min(srcN, tgtN) + FAN_OUT_MARGIN;
    const cHi = Math.max(srcN, tgtN) - FAN_OUT_MARGIN;
    const aLo = Math.min(...valid.map((x) => Math.min(x.exit, x.target)));
    const aHi = Math.max(...valid.map((x) => Math.max(x.exit, x.target)));
    const ends = new Set(members.flatMap(({ e }) => [e.source, e.target]));
    const bands: [number, number][] = [];
    for (const { id: nid, r } of tiles) {
      if (ends.has(nid)) continue;
      const across = horiz ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
      if (!(across[0] < aHi && across[1] > aLo)) continue; // not in the fan's across span
      const along = horiz ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
      bands.push([along[0] - FAN_OUT_GRAZE, along[1] + FAN_OUT_GRAZE]);
    }

    // Largest free stretch of the corridor that can hold the bundle; else the whole corridor.
    const holds = (len: number) => m === 1 || len / (m - 1) >= FAN_OUT_MIN_GAP;
    const free = cHi > cLo ? freeIntervals(cLo, cHi, bands).filter(([a, b]) => holds(b - a)) : [];
    const best = free.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    const [sLo, sHi] = best ?? [cLo, cHi];
    const wide = sHi > sLo && holds(sHi - sLo);
    const center = wide ? (sLo + sHi) / 2 : (srcN + tgtN) / 2;
    const gap = wide && m > 1 ? Math.min((sHi - sLo) / (m - 1), FAN_OUT_SPACING) : FAN_OUT_MIN_GAP;

    order.forEach((mem, k) => {
      const c = center + dir * ((m - 1) / 2 - k) * gap;
      const f = out.get(mem.id)!;
      owned.add(mem.id);
      if (horiz) {
        f.centerX = c;
        const vs = vertSpans.get(mem.id);
        if (vs) { vs.effX = c; vs.hasCenter = true; }
      } else {
        f.centerY = c;
      }
    });
  }
  return owned;
}

// --- fan-out un-crossing (measured, never regresses) ------------------------
// Two edges leaving the SAME source side to different targets can cross on their
// elbows even when their exit/entry order is consistent: the upper edge's shorter
// drop turns down at a small X that the lower edge's longer horizontal run passes
// through (architecture-complete: Lakehouse→AI/BI-Dashboard ✕ Lakehouse→Genie).
// This is a MEASURED post-pass, not a blanket rule: for each crossing fan-out pair
// it tries ordering the two elbows to match the exit order (higher exit → elbow
// further toward the target) and KEEPS the change only if the pair stops crossing.
// So it can only ever remove a fan-out crossing — never add one, and never touches
// a pair that already reads clean (which is what wrecked the dense fixtures when the
// ordering was applied unconditionally in the main loop).
function uncrossFanOut(
  out: Map<string, FanEntry>,
  edges: FanEdge[],
  rect: (nid: string) => Rect | null,
): void {
  const poly = (e: FanEdge, f: FanEntry): { x: number; y: number }[] | null => {
    const sR = rect(e.source), tR = rect(e.target);
    if (!sR || !tR) return null;
    return flattenPath(drawnPath(f, sR, tR, e.data?.shape ?? "smooth", e.data?.centerX).path);
  };
  const ccw = (P: {x:number;y:number}, Q: {x:number;y:number}, R: {x:number;y:number}) =>
    (R.y - P.y) * (Q.x - P.x) - (Q.y - P.y) * (R.x - P.x);
  const cross = (A: {x:number;y:number}[], B: {x:number;y:number}[]): boolean => {
    for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
      const a = A[i-1], b = A[i], c = B[j-1], d = B[j];
      if (ccw(a,c,d)*ccw(b,c,d) < 0 && ccw(a,b,c)*ccw(a,b,d) < 0) return true;
    }
    return false;
  };

  // Group horizontal-run edges (both ends l/r, no vertical port pinning) by source.
  const bySource = new Map<string, FanEdge[]>();
  for (const e of edges) {
    const f = out.get(e.id);
    if (!f) continue;
    if (!((f.sSide === "l" || f.sSide === "r") && (f.tSide === "l" || f.tSide === "r"))) continue;
    (bySource.get(e.source) ?? bySource.set(e.source, []).get(e.source)!).push(e);
  }

  for (const [src, group] of bySource) {
    if (group.length < 2) continue;
    const sR = rect(src);
    if (!sR) continue;
    // Consider each crossing PAIR. The fix orders the two elbows by exit-Y so the
    // higher-exit edge turns down further toward its target.
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const ea = group[a], eb = group[b];
      const fa = out.get(ea.id)!, fb = out.get(eb.id)!;
      const pa = poly(ea, fa), pb = poly(eb, fb);
      if (!pa || !pb || !cross(pa, pb)) continue;

      // Exit Y of each (source-anchor Y). Higher exit = smaller Y.
      const ayExit = sidePoint(sR, fa.sSide, fa.sFrac).y;
      const byExit = sidePoint(sR, fb.sSide, fb.sFrac).y;
      const tRa = rect(ea.target)!, tRb = rect(eb.target)!;
      const corr = (f: FanEntry, tR: Rect) => {
        const sx = f.sSide === "r" ? sR.x + sR.w : sR.x;
        const tx = f.tSide === "l" ? tR.x : tR.x + tR.w;
        return { lo: Math.min(sx, tx) + 20, hi: Math.max(sx, tx) - 20, toward: f.sSide === "r" ? 1 : -1 };
      };
      const ca = corr(fa, tRa), cb = corr(fb, tRb);
      if (!(ca.hi > ca.lo) || !(cb.hi > cb.lo)) continue;
      // higher exit → elbow toward target (frac 1); lower exit → toward source (0).
      const aHigher = ayExit <= byExit;
      const fracA = aHigher ? 0.8 : 0.35;
      const fracB = aHigher ? 0.35 : 0.8;
      const candA = ca.toward === 1 ? ca.lo + fracA * (ca.hi - ca.lo) : ca.hi - fracA * (ca.hi - ca.lo);
      const candB = cb.toward === 1 ? cb.lo + fracB * (cb.hi - cb.lo) : cb.hi - fracB * (cb.hi - cb.lo);
      const na = poly(ea, { ...fa, centerX: candA })!;
      const nb = poly(eb, { ...fb, centerX: candB })!;
      // Keep ONLY if the reorder actually stops them crossing.
      if (!cross(na, nb)) {
        out.get(ea.id)!.centerX = candA;
        out.get(eb.id)!.centerX = candB;
      }
    }
  }
}

// --- parallel-lane separation (AUTO edges only) -----------------------------
// Two different edges whose axis-aligned runs sit closer than LANE_MIN_SEP for a
// real span read as ONE line (inspect-arch PARALLEL OVERLAP). The fan passes only
// separate edges that share a node side; runs that meet by coincidence (different
// sources, or a shared named port whose paths diverge after the stub) were left
// on top of each other.
//
// Fix is a LOCAL, MEASURED search: for each edge that participates in a conflict,
// try nudging ITS OWN free ends along their side, or its elbow for an l/r→l/r edge,
// and keep a move only when the edge's cost against every other edge drops. The
// cost counts parallel runs, proper crossings (not between edges sharing a node,
// where convergence is expected), and tiles the path runs through, so a move can't
// trade one fault for another. Named ports and manual centerX stay exactly as
// authored; `avoidTiles` runs after this and still gets the final word on tiles.
const LANE_MIN_SEP = 14;     // px — target clearance; inspect-arch PARALLEL OVERLAP flags < 10
const LANE_MIN_OVERLAP = 24; // px — shorter overlap is an anchor stub, not a run
const LANE_NUDGE_PX = [-8, -16, 8, 16];
const LANE_ELBOW_STEPS = [-16, -32, 16, 32];
/** Edge-end graze tolerance — mirrors inspect-arch's GRAZE (a run alongside a tile
 *  face within this many px reads as touching it). */
const LANE_GRAZE = 10;
const LANE_END_MARGIN = 18;

function laneSegs(poly: { x: number; y: number }[]) {
  const out: { axis: "H" | "V"; c: number; lo: number; hi: number; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    if (Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) > 1) out.push({ axis: "V", c: (a.x + b.x) / 2, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), a, b });
    else if (Math.abs(a.y - b.y) <= 2 && Math.abs(a.x - b.x) > 1) out.push({ axis: "H", c: (a.y + b.y) / 2, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), a, b });
  }
  return out;
}

function ccwSign(P: { x: number; y: number }, Q: { x: number; y: number }, R: { x: number; y: number }): number {
  return (R.y - P.y) * (Q.x - P.x) - (Q.y - P.y) * (R.x - P.x);
}

/** Parallel-run and proper-crossing counts between two drawn polylines. Crossings count for EVERY
 *  pair, including two edges that share a node: a fan's own lines crossing is a fault, not convergence. */
function pairConflicts(A: { x: number; y: number }[], B: { x: number; y: number }[]): number {
  let n = 0;
  const sa = laneSegs(A), sb = laneSegs(B);
  for (const s of sa) for (const t of sb) {
    if (s.axis !== t.axis || Math.abs(s.c - t.c) >= LANE_MIN_SEP) continue;
    // One conflict, plus up to one more as the runs close: 3px apart is worse than 12px apart,
    // and a count alone can't tell them apart (the solver would squeeze a fan into one line).
    if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) >= LANE_MIN_OVERLAP) n += 1 + (LANE_MIN_SEP - Math.abs(s.c - t.c)) / LANE_MIN_SEP;
  }
  for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
    const p = A[i - 1], q = A[i], r = B[j - 1], t = B[j];
    if (ccwSign(p, r, t) * ccwSign(q, r, t) < 0 && ccwSign(p, q, r) * ccwSign(p, q, t) < 0) n++;
  }
  return n;
}

function laneSeparate(
  out: Map<string, FanEntry>,
  edges: FanEdge[],
  rect: (nid: string) => Rect | null,
  nodeLookup: NodeLookup,
  fanOwned: Set<string>,
): void {
  const live = edges
    .filter((e) => out.has(e.id) && rect(e.source) && rect(e.target))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (live.length < 2) return;

  const nodes: { id: string; r: Rect }[] = [];
  for (const nid of nodeLookup.keys()) {
    const r = rect(nid);
    if (r && r.w > 0 && r.h > 0) nodes.push({ id: nid, r });
  }
  const { tiles } = partitionNodes(nodes);

  const polyOf = (e: FanEdge, f: FanEntry): { x: number; y: number }[] =>
    flattenPath(drawnPath(f, rect(e.source)!, rect(e.target)!, e.data?.shape ?? "smooth", e.data?.centerX).path);
  let polys = live.map((e) => polyOf(e, out.get(e.id)!));
  const tileHits = (i: number, poly: { x: number; y: number }[]): number =>
    tilesCrossed(poly, tiles, new Set([live[i].source, live[i].target])).length;
  /** Runs alongside a tile face within LANE_GRAZE (inspect-arch EDGE GRAZES TILE). */
  const grazeHits = (i: number, poly: { x: number; y: number }[]): number => {
    const ends = [poly[0], poly[poly.length - 1]];
    const near = (r: Rect) => ends.some((q) => q.x > r.x - LANE_END_MARGIN && q.x < r.x + r.w + LANE_END_MARGIN &&
      q.y > r.y - LANE_END_MARGIN && q.y < r.y + r.h + LANE_END_MARGIN);
    let n = 0;
    for (const sg of laneSegs(poly)) {
      for (const t of tiles) {
        if (t.id === live[i].source || t.id === live[i].target || near(t.r)) continue;
        const r = t.r;
        if (sg.axis === "V") {
          const ovY = sg.lo < r.y + r.h - 4 && sg.hi > r.y + 4;
          if (ovY && (Math.abs(sg.c - r.x) <= LANE_GRAZE || Math.abs(sg.c - (r.x + r.w)) <= LANE_GRAZE)) n++;
        } else {
          const ovX = sg.lo < r.x + r.w - 4 && sg.hi > r.x + 4;
          if (ovX && (Math.abs(sg.c - r.y) <= LANE_GRAZE || Math.abs(sg.c - (r.y + r.h)) <= LANE_GRAZE)) n++;
        }
      }
    }
    return n;
  };

  // Cost of edge i against every other edge (tiles included). Only pairs involving i
  // change when i moves, so comparing this local cost is an exact delta.
  const localCost = (i: number, poly: { x: number; y: number }[]): number => {
    let c = tileHits(i, poly) * 20 + grazeHits(i, poly) * 10;
    for (let j = 0; j < live.length; j++) {
      if (j === i) continue;
      c += pairConflicts(poly, polys[j]) * 10;
    }
    return c;
  };

  // Nothing to do unless some pair actually runs parallel — the common case is free.
  let anyParallel = false;
  for (let i = 0; i < live.length && !anyParallel; i++) {
    if (grazeHits(i, polys[i]) > 0) anyParallel = true;
    for (let j = 0; j < i && !anyParallel; j++)
      if (pairConflicts(polys[i], polys[j]) > 0) anyParallel = true;
  }
  if (!anyParallel) return;

  for (let sweep = 0; sweep < 3; sweep++) {
    let moved = false;
    for (let i = 0; i < live.length; i++) {
      const e = live[i];
      const f0 = out.get(e.id)!;
      if (e.data?.centerX !== undefined) continue; // manual elbow: authored, leave it
      const base = localCost(i, polys[i]);
      if (base === 0) continue;

      let best: { f: FanEntry; poly: { x: number; y: number }[]; cost: number } | null = null;
      const consider = (f: FanEntry) => {
        const poly = polyOf(e, f);
        const cost = localCost(i, poly);
        if (cost < (best?.cost ?? base)) best = { f, poly, cost };
      };
      // Free ends only: a named port fixes its anchor (and drives the flow animation).
      if (!isNamedPort(e.sourceHandle)) {
        const L = f0.sSide === "l" || f0.sSide === "r" ? rect(e.source)!.h : rect(e.source)!.w;
        for (const px of LANE_NUDGE_PX) {
          consider({ ...f0, sFrac: Math.max(0.08, Math.min(0.92, f0.sFrac + px / L)) });
        }
      }
      if (!isNamedPort(e.targetHandle)) {
        const L = f0.tSide === "l" || f0.tSide === "r" ? rect(e.target)!.h : rect(e.target)!.w;
        for (const px of LANE_NUDGE_PX) {
          consider({ ...f0, tFrac: Math.max(0.08, Math.min(0.92, f0.tFrac + px / L)) });
        }
      }
      // Elbow nudge for an l/r → l/r edge (the vertical run moves; the stubs don't).
      // A same-source fan owns its elbow (assignFanOutElbows): nudging one breaks the nesting. Its
      // free ends may still move — the crossing term keeps any move that reorders the fan out.
      const horiz = (f0.sSide === "l" || f0.sSide === "r") && (f0.tSide === "l" || f0.tSide === "r");
      if (horiz && !fanOwned.has(e.id)) {
        const sR = rect(e.source)!, tR = rect(e.target)!;
        const mid = f0.centerX ?? (((f0.sSide === "r" ? sR.x + sR.w : sR.x) + (f0.tSide === "l" ? tR.x : tR.x + tR.w)) / 2);
        for (const d of LANE_ELBOW_STEPS) consider({ ...f0, centerX: mid + d });
        const hugS = (f0.sSide === "r" ? sR.x + sR.w : sR.x) + (f0.sSide === "r" ? 16 : -16);
        const hugT = (f0.tSide === "l" ? tR.x : tR.x + tR.w) + (f0.tSide === "l" ? -16 : 16);
        consider({ ...f0, centerX: hugS });
        consider({ ...f0, centerX: hugT });
      }

      if (best) {
        const b = best as { f: FanEntry; poly: { x: number; y: number }[]; cost: number };
        out.set(e.id, b.f);
        polys[i] = b.poly;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// --- tile avoidance --------------------------------------------------------
// The router has no node avoidance, so a line spanning more than about two
// columns will run straight through whatever tiles sit between its ends
// (`inspect-arch`'s EDGE THROUGH TILE). We can't fix that by bending the path —
// smooth-step gives us one vertical elbow, not arbitrary waypoints — but we can
// choose BETTER ANCHORS: which side each end leaves from, and where the elbow
// sits. A search over those levers clears the cases we have.
//
// This runs LAST, inside computeFanLayout, on purpose: `crossings` and
// `label-layout` both read fan entries and rebuild the path from them, so
// adjusting the entry keeps the drawn line, its line-jumps and its label all in
// agreement. Adjusting it anywhere else would desynchronise them.

/** Do two drawn polylines properly cross (an X)? A shared endpoint is not a crossing. */
function polylinesCross(A: { x: number; y: number }[], B: { x: number; y: number }[]): boolean {
  for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
    const p = A[i - 1], q = A[i], r = B[j - 1], t = B[j];
    if (ccwSign(p, r, t) * ccwSign(q, r, t) < 0 && ccwSign(p, q, r) * ccwSign(p, q, t) < 0) return true;
  }
  return false;
}

/** Side options, in a fixed order so the search is deterministic. */
const SIDE_ORDER: Side[] = ["r", "l", "b", "t"];

/** A NAMED port (`in-*`, `out-*`, `acl-*`, `bl`, …) is semantically load-bearing:
 *  it fixes the anchor AND drives the flow animation. Never move one. A plain
 *  `t/r/b/l` handle is only a routing hint, so it may be overridden — but only as
 *  a last resort, on an edge whose default already runs through a tile. */
const isNamedPort = (h?: string | null): boolean =>
  !!h && !(["t", "r", "b", "l"] as string[]).includes(h);

/**
 * Re-anchor edges whose drawn path runs through an unrelated tile.
 *
 * Graduated, so the smallest deviation that works wins:
 *   1. keep both sides, sweep the vertical elbow across the corridor;
 *   2. also move ends whose side was INFERRED (no handle authored);
 *   3. also move ends carrying a plain side hint (named ports stay frozen).
 *
 * Only edges that ALREADY cross a tile are touched, and an edge is left exactly
 * as it was when no candidate is clean — a worse-but-different route is not an
 * improvement. Clearing a tile can cost an elbow its de-overlap track from the
 * pass above; that trade is deliberate (a line through a tile is the worse fault).
 */
function avoidTiles(
  out: Map<string, FanEntry>,
  edges: FanEdge[],
  nodeLookup: NodeLookup,
  rect: (nid: string) => Rect | null,
): void {
  // Obstacles are EVERY tile on the canvas — iterate the node lookup, NOT the
  // edge endpoints. The tile a long line runs through usually has no edges of its
  // own, so collecting obstacles from endpoints makes exactly the obstacles that
  // matter invisible.
  const nodes: { id: string; r: Rect }[] = [];
  for (const nid of nodeLookup.keys()) {
    const r = rect(nid);
    if (r && r.w > 0 && r.h > 0) nodes.push({ id: nid, r });
  }
  if (nodes.length === 0) return;
  const { tiles, containers } = partitionNodes(nodes);
  // A container's TITLE STRIP is an obstacle too (TITLE CROSSED BY EDGE): a line through a
  // box's label is as wrong as one through a tile. Tagged with the container's id, so the
  // endpoint exemption below (`tilesCrossed`'s exclude set) lets an edge leave or enter the
  // box it is attached to. Only the strip, not the body: edges routinely run inside a box.
  const obstacles = [...tiles, ...containers.map((c) => ({ id: c.id, r: titleStripOf(c.r) }))];
  if (obstacles.length === 0) return;

  // The polyline the renderer draws for an entry (curves sampled, so a corner contact counts).
  const drawnPolyline = (e: FanEdge, f: FanEntry, sR: Rect, tR: Rect): { x: number; y: number }[] =>
    flattenPath(drawnPath(f, sR, tR, e.data?.shape ?? "smooth", e.data?.centerX).path);
  // The avoidance pass measures crossings on the path the RENDERER draws (the
  // rects handed in are the same anchor rects the render uses), so the path judged
  // here is the path drawn.
  const crossingCount = (e: FanEdge, f: FanEntry, sR: Rect, tR: Rect): number => {
    const poly = pathToPolyline(drawnPath(
      f, sR, tR, e.data?.shape ?? "smooth", e.data?.centerX,
    ).path);
    return tilesCrossed(poly, obstacles, new Set([e.source, e.target])).length;
  };

  // Stable id order so two runs over the same graph agree.
  const ordered = edges.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const e of ordered) {
    const f = out.get(e.id);
    const sR = rect(e.source);
    const tR = rect(e.target);
    if (!f || !sR || !tR) continue;
    // Fast path: almost every edge is already clean, and pays one path build.
    if (crossingCount(e, f, sR, tR) === 0) continue;

    // The OTHER edges' drawn paths, once per edge: a re-anchor must not buy its way off a tile by
    // crossing a line (moving e14 from a right exit to a bottom entry re-broke a fan's nesting).
    const others: { x: number; y: number }[][] = [];
    for (const o of edges) {
      if (o.id === e.id) continue;
      const fo = out.get(o.id), so = rect(o.source), to = rect(o.target);
      if (fo && so && to) others.push(drawnPolyline(o, fo, so, to));
    }
    const crossesOther = (poly: { x: number; y: number }[]): boolean =>
      others.some((B) => polylinesCross(poly, B));

    const lo = Math.min(sR.x, tR.x) - 140;
    const hi = Math.max(sR.x + sR.w, tR.x + tR.w) + 140;
    const elbows: (number | undefined)[] = [undefined];
    for (let k = 0; k <= 16; k++) elbows.push(lo + (k * (hi - lo)) / 16);

    // Graduated search. "strict" also refuses a candidate that crosses another line; the
    // tile-only search is the fallback, so an edge never ends up worse on tiles than it started.
    const search = (strict: boolean): FanEntry | null => {
      for (const stage of [1, 2, 3] as const) {
        const sFree = stage >= 2 && !isNamedPort(e.sourceHandle) &&
          (e.sourceHandle == null || stage === 3);
        const tFree = stage >= 2 && !isNamedPort(e.targetHandle) &&
          (e.targetHandle == null || stage === 3);
        // Current side first, so an unnecessary change never wins a tie.
        const sOpts = sFree ? [f.sSide, ...SIDE_ORDER.filter((s) => s !== f.sSide)] : [f.sSide];
        const tOpts = tFree ? [f.tSide, ...SIDE_ORDER.filter((s) => s !== f.tSide)] : [f.tSide];

        for (const ss of sOpts) {
          for (const ts of tOpts) {
            const horiz = (ss === "l" || ss === "r") && (ts === "l" || ts === "r");
            for (const cx of horiz ? elbows : [undefined]) {
              const cand: FanEntry = { ...f, sSide: ss, tSide: ts, centerX: cx };
              if (crossingCount(e, cand, sR, tR) !== 0) continue;
              if (strict && crossesOther(drawnPolyline(e, cand, sR, tR))) continue;
              return cand;
            }
          }
        }
      }
      return null;
    };
    const best = search(true) ?? search(false);
    if (best) out.set(e.id, best);
  }
}
