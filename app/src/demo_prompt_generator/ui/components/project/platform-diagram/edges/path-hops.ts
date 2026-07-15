/**
 * platform-diagram/edges/path-hops — inject "line jump" arcs into an SVG edge
 * path at the crossing points computed by `crossings.ts`.
 *
 * We re-parse the path into its command list, walk each STRAIGHT (`L`) segment,
 * and where a hop point lies on it, replace a short span (~HOP_R each side of
 * the crossing) with a small semicircular `A` arc that bulges perpendicular to
 * the segment — so the line reads as hopping OVER the crossed one. Hops that
 * land on a rounded corner (a `Q` command) are skipped (rare, and a corner is a
 * poor place for a jump anyway). Curves and the overall path shape are otherwise
 * preserved, so the SAME hopped string drives the base line, the arrowhead
 * overlay, and the flow animation.
 */
import type { Hop } from "./crossings";

const HOP_R = 6; // arc radius (also the half-span replaced on the segment)

interface Cmd {
  c: "M" | "L" | "Q";
  /** Absolute end point of the command. */
  x: number;
  y: number;
  /** Q control point (only for c === "Q"). */
  cx?: number;
  cy?: number;
}

function parse(path: string): Cmd[] {
  const cmds: Cmd[] = [];
  const re = /([MLQ])([^MLQ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const c = m[1] as Cmd["c"];
    const n = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (c === "Q" && n.length >= 4) cmds.push({ c, cx: n[0], cy: n[1], x: n[2], y: n[3] });
    else if ((c === "M" || c === "L") && n.length >= 2) {
      // A command may carry multiple coordinate pairs; emit one per pair (the
      // first M pair is a move, subsequent pairs are implicit L — but
      // getSmoothStepPath never chains, so one pair each in practice).
      for (let i = 0; i + 1 < n.length; i += 2) {
        cmds.push({ c: i === 0 ? c : "L", x: n[i], y: n[i + 1] });
      }
    }
  }
  return cmds;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Return the path with hop arcs injected. `hops` are crossing points (flow
 * coords) that fall somewhere on the path; each that lies on a straight segment
 * (with enough room) becomes a small bump. Falls back to the original path when
 * there are no hops or none land on a straight run.
 */
export function injectHops(path: string, hops: Hop[]): string {
  if (!hops.length) return path;
  const cmds = parse(path);
  if (cmds.length < 2) return path;

  let out = `M${round(cmds[0].x)} ${round(cmds[0].y)}`;
  let prev = { x: cmds[0].x, y: cmds[0].y };

  for (let i = 1; i < cmds.length; i++) {
    const cmd = cmds[i];
    if (cmd.c === "Q") {
      // Rounded corner — pass through untouched (hops on corners are skipped).
      out += `Q${round(cmd.cx!)} ${round(cmd.cy!)} ${round(cmd.x)} ${round(cmd.y)}`;
      prev = { x: cmd.x, y: cmd.y };
      continue;
    }
    // Straight segment prev → cmd. Collect hops that lie on it, ordered along it.
    const dx = cmd.x - prev.x, dy = cmd.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) { prev = { x: cmd.x, y: cmd.y }; continue; }
    const ux = dx / len, uy = dy / len; // unit direction along the segment
    const on: { t: number; hop: Hop }[] = [];
    for (const h of hops) {
      // Project the hop onto the segment; keep it only if it's ON the line
      // (small perpendicular distance) with room for the full arc at both ends.
      const t = (h.x - prev.x) * ux + (h.y - prev.y) * uy;
      const px = prev.x + t * ux, py = prev.y + t * uy;
      const perp = Math.hypot(h.x - px, h.y - py);
      if (perp < 2 && t > HOP_R && t < len - HOP_R) on.push({ t, hop: h });
    }
    on.sort((a, b) => a.t - b.t);

    // Emit sub-lines with a semicircular bump at each hop. A half-circle of
    // radius HOP_R spanning enter→exit reads as the line jumping OVER; the
    // sweep-flag (1) fixes which side it bulges — consistent for every jump.
    for (const { t } of on) {
      const enter = { x: prev.x + (t - HOP_R) * ux, y: prev.y + (t - HOP_R) * uy };
      const exit = { x: prev.x + (t + HOP_R) * ux, y: prev.y + (t + HOP_R) * uy };
      out += `L${round(enter.x)} ${round(enter.y)}`;
      out += `A${HOP_R} ${HOP_R} 0 0 1 ${round(exit.x)} ${round(exit.y)}`;
    }
    out += `L${round(cmd.x)} ${round(cmd.y)}`;
    prev = { x: cmd.x, y: cmd.y };
  }
  return out;
}
