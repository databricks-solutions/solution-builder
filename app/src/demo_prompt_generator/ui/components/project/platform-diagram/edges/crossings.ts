/**
 * platform-diagram/edges/crossings — "line jumps". When one edge crosses
 * another, the edge drawn ON TOP gets a small semicircular hop at the crossing
 * so it reads as going OVER the other line (Lucidchart-style).
 *
 * Like `fan-layout`, this is computed for ALL edges AT ONCE and memoized on a
 * cheap signature of the geometry, so the E FlowEdge selectors that call it
 * within one store tick share ONE computation + E O(1) lookups. Pure geometry —
 * no React, no ReactFlow context; it reuses `computeFanLayout` (for each edge's
 * sides/frac/elbow) and the rect/side helpers.
 *
 * To detect crossings we need each edge's polyline. Rather than re-derive it
 * (which drifts from what's actually drawn — the smooth-step router turns toward
 * the ENTRY side, so a naive L-corner is wrong for t/b targets and can leave two
 * lines collinear-overlapping where they should cross at a point), we build it
 * from `edge-geometry.drawnPath` — the shared at-rest geometry FlowEdge's own
 * arg assembly mirrors (same shrunk stub + centerX guard) — then
 * `pathToPolyline` its output. The crossings therefore match the rendered
 * geometry pixel-for-pixel. Injecting the arc into the SVG path string lives in
 * `path-hops.ts` (FlowEdge owns the actual path string).
 */
import { type Rect, rectOf } from "../edge-routing";
import { computeFanLayout } from "../fan-layout";
import { type EdgeShape, drawnPath, pathToPolyline } from "./edge-geometry";

// Re-exported for callers that predate `edge-geometry` (the parser moved there
// so the label pass could share it).
export { pathToPolyline } from "./edge-geometry";

export interface Hop {
  /** Crossing point (flow coords). */
  x: number;
  y: number;
}

interface CrossEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Edge shape (mirrors FlowEdge's `data.shape`): straight | step | smooth. */
  data?: { shape?: EdgeShape; centerX?: number } | null;
}
interface CrossNode {
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
}
type NodeLookup = Map<string, CrossNode>;

/** Intersection of segments AB and CD, or null. Only a PROPER crossing counts
 *  (strictly interior on both) — a shared endpoint / T-junction shouldn't hop. */
function segIntersect(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): { x: number; y: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-6) return null; // parallel / collinear
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  const EPS = 0.02; // keep crossings off the very endpoints (shared corners)
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

// --- 1-deep memo cache (same pattern as fan-layout) ------------------------
let cacheSig = "";
let cacheMap: Map<string, Hop[]> = new Map();

function signature(edges: CrossEdge[], nodeLookup: NodeLookup): string {
  let s = "";
  for (const e of edges) s += `${e.id}:${e.source}>${e.target};`;
  s += "|";
  const seen = new Set<string>();
  for (const e of edges) {
    for (const nid of [e.source, e.target]) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      const n = nodeLookup.get(nid);
      if (!n) continue;
      const p = n.internals.positionAbsolute;
      s += `${nid}:${Math.round(p.x)},${Math.round(p.y)},${n.measured.width ?? 0}x${n.measured.height ?? 0};`;
    }
  }
  return s;
}

/** Max hops per edge — a pathological many-crossing diagram would otherwise
 *  litter one line with jumps; past this we skip hops on that edge. */
const MAX_HOPS = 8;

/**
 * Compute (or return cached) hop points per edge. For each pair of edges that
 * don't share a node, find where their polylines cross; the edge that "hops" is
 * chosen deterministically (greater id) so BOTH edges agree and exactly one
 * hops. Returns Map<edgeId, Hop[]>.
 */
export function computeCrossings(
  edges: CrossEdge[],
  nodeLookup: NodeLookup,
): Map<string, Hop[]> {
  // No input-identity short-circuit — see the NOTE in fan-layout.ts
  // computeFanLayout: v12 mutates nodeLookup in place and keeps `edges` stable
  // across a drag, so identity would be stale. The signature folds node
  // positions and is the correct invalidator.
  const sig = signature(edges, nodeLookup);
  if (sig === cacheSig) return cacheMap;

  const fan = computeFanLayout(edges, nodeLookup);
  const rect = (nid: string): Rect | null => {
    const n = nodeLookup.get(nid);
    return n ? rectOf(n as never) : null;
  };

  // Build the edge's polyline from the EXACT path FlowEdge draws (shared
  // `drawnPath`: shrunk stub + guarded centerX). Deriving it any other way drifts
  // from the render (the router turns toward the entry side), which both misses
  // crossings and produces spurious collinear overlaps — see the module header.
  const polylineOf = (e: CrossEdge): { x: number; y: number }[] | null => {
    const f = fan.get(e.id);
    const sR = rect(e.source), tR = rect(e.target);
    if (!f || !sR || !tR) return null;
    return pathToPolyline(drawnPath(
      f, sR, tR, e.data?.shape ?? "smooth", e.data?.centerX,
    ).path);
  };

  const polys = new Map<string, { x: number; y: number }[]>();
  for (const e of edges) {
    const pl = polylineOf(e);
    if (pl) polys.set(e.id, pl);
  }

  const out = new Map<string, Hop[]>();
  for (const e of edges) out.set(e.id, []);

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i], e2 = edges[j];
      if (e1.source === e2.source || e1.source === e2.target ||
          e1.target === e2.source || e1.target === e2.target) continue;
      const p1 = polys.get(e1.id), p2 = polys.get(e2.id);
      if (!p1 || !p2) continue;
      // The edge with the greater id hops (deterministic — both agree).
      const hopper = e1.id > e2.id ? e1.id : e2.id;
      const hops = out.get(hopper)!;
      for (let a = 0; a + 1 < p1.length; a++) {
        for (let b = 0; b + 1 < p2.length; b++) {
          const x = segIntersect(p1[a], p1[a + 1], p2[b], p2[b + 1]);
          if (x) hops.push(x);
        }
      }
    }
  }

  // De-dupe near-coincident hops + cap.
  for (const [id, hops] of out) {
    const dedup: Hop[] = [];
    for (const h of hops) {
      if (!dedup.some((k) => Math.abs(k.x - h.x) < 3 && Math.abs(k.y - h.y) < 3)) dedup.push(h);
    }
    out.set(id, dedup.length > MAX_HOPS ? [] : dedup);
  }

  cacheSig = sig;
  cacheMap = out;
  return out;
}
