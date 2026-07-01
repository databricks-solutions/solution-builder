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
  sidePoint,
  spreadFrac,
  endSide,
  rectOf,
} from "./edge-routing";
import { PORT_FRAC, portAnchor } from "./composite-lakeflow";

export interface FanEntry {
  sSide: Side;
  tSide: Side;
  sFrac: number;
  tFrac: number;
  centerX: number | undefined;
}

/** Minimal shape of a ReactFlow edge we read (source/target + handles). */
interface FanEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
/** Minimal shape of ReactFlow's internal node (from `s.nodeLookup`). */
interface FanNode {
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
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

function signature(edges: FanEdge[], nodeLookup: NodeLookup): string {
  let s = "";
  for (const e of edges) {
    s += `${e.id}:${e.source}>${e.target}:${e.sourceHandle ?? ""}/${e.targetHandle ?? ""};`;
  }
  s += "|";
  // Only the nodes that participate in an edge affect the layout.
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

/** Compute (or return cached) fan entries for every edge. */
export function computeFanLayout(edges: FanEdge[], nodeLookup: NodeLookup): Map<string, FanEntry> {
  const sig = signature(edges, nodeLookup);
  if (sig === cacheSig) return cacheMap;

  const rect = (nid: string): Rect | null => {
    const n = nodeLookup.get(nid);
    return n ? rectOf(n as never) : null;
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
      const port = handle && handle in PORT_FRAC ? handle : null;
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

  const portFan = (base: number, i: number, n: number) =>
    n <= 1 ? base : Math.min(0.95, Math.max(0.05, base + (i - (n - 1) / 2) * 0.06));

  const out = new Map<string, FanEntry>();
  for (const e of edges) {
    const sR = rect(e.source);
    const tR = rect(e.target);
    if (!sR || !tR) continue;
    const sCtr = { x: sR.x + sR.w / 2, y: sR.y + sR.h / 2 };
    const tCtr = { x: tR.x + tR.w / 2, y: tR.y + tR.h / 2 };
    const ss = endSide(sR, e.sourceHandle, tCtr);
    const ts = endSide(tR, e.targetHandle, sCtr);
    const sPort = portAnchor(e.sourceHandle);
    const tPort = portAnchor(e.targetHandle);
    const sg = idxIn(sPort ? `${e.source}|${e.sourceHandle}` : `${e.source}|${ss}`, e.id);
    const tg = idxIn(tPort ? `${e.target}|${e.targetHandle}` : `${e.target}|${ts}`, e.id);

    const tEndSide = tPort?.side ?? ts;
    const tFrac = tPort ? portFan(tPort.frac, tg.i < 0 ? 0 : tg.i, tg.n) : spreadFrac(tg.i < 0 ? 0 : tg.i, tg.n);
    let centerX: number | undefined;
    if (tg.n > 1 && (tEndSide === "l" || tEndSide === "r")) {
      const midX = (sCtr.x + tCtr.x) / 2;
      const STEP = 22;
      const anchorY = sidePoint(tR, tEndSide, tFrac).y;
      const sibs = sortedGroups.get(tPort ? `${e.target}|${e.targetHandle}` : `${e.target}|${ts}`) ?? [];
      const above = sCtr.y < anchorY;
      const sameSide = sibs.filter((x) => (above ? x.key < anchorY : x.key >= anchorY));
      const pos = sameSide.findIndex((x) => x.id === e.id);
      const mag = sameSide.length - pos;
      centerX = midX + (above ? 1 : -1) * mag * STEP;
    }
    out.set(e.id, {
      sSide: sPort?.side ?? ss,
      tSide: tPort?.side ?? ts,
      sFrac: sPort ? portFan(sPort.frac, sg.i < 0 ? 0 : sg.i, sg.n) : spreadFrac(sg.i < 0 ? 0 : sg.i, sg.n),
      tFrac,
      centerX,
    });
  }

  cacheSig = sig;
  cacheMap = out;
  return out;
}
