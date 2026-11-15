/**
 * test-diagram-layout — unit tests for the PURE diagram-layout geometry:
 * `edges/edge-geometry` (the shared at-rest path) and `edges/label-layout` (edge
 * label de-confliction).
 *
 *   cd app && bun run test:layout
 *
 * Why this exists: until now the only check on diagram geometry was
 * `scripts/inspect-arch.mjs`, which needs a headless browser and a rendered HTML
 * page. That catches real visual faults but is slow, can't run without Chromium,
 * and can't pin the INTENT of a rule (e.g. "prefer sliding along the line over
 * stepping off it"). These functions are pure, so assert them directly.
 *
 * Run it after touching edge-geometry, label-layout, fan-layout or edge-routing.
 * `inspect-arch` remains the end-to-end check; this is the fast inner loop.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sanitizeCardBody, sanitizeDiagramHtml, sanitizeCardStyle, legacyCardBody } from "../src/demo_prompt_generator/ui/lib/card-body";
import {
  stubOffset,
  turnClearY,
  guardCenterX,
  pathToPolyline,
  runAt,
  drawnPath,
  flattenPath,
  segmentHitsRect,
  partitionNodes,
  tilesCrossed,
  labelAnchorAt,
  labelPosFromPoint,
  labelTBounds,
  resolveLabelAnchor,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edges/edge-geometry";
import {
  sidePoint,
  spreadFrac,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edge-routing";
import { computeFanLayout } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/fan-layout";
import { computeLabelOffsets } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edges/label-layout";
import { nodeFootprint } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/shared";
import { isGenericLabel } from "./eval-arch";
import { applyMdFormat } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/md-format";
import {
  shapePath,
  shapeTextInset,
  SHAPE_KINDS,
  SHAPE_LABEL,
  DEFAULT_SHAPE_KIND,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/shape-geometry";
import {
  wrapLabel,
  isClamped,
  measureLabel,
  lineCenterY,
  MAX_TEXT_W,
  CHAR_W,
  MAX_LINES,
  LINE_H,
  CHIP_PAD_X,
  CHIP_PAD_Y,
  chipSize,
  EDGE_LABEL_FONT,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edges/label-chip";
import {
  parseArchitecture,
  serializeArchitecture,
  legendEntries,
  legendBoxMetrics,
  legendShows,
  LEGEND_NODE_ID,
  validateArchitecture,
  assessPresentationAspect,
  FRAME_TITLE_NODE_ID,
  assessFlowOrientation,
  verticalSourceSize,
  logoFootprint,
  computeLayout,
  boxBorderTitleW,
  isShapeKind,
  multiSourceSize,
  multiSourceItems,
  cardLayout,
  htmlBlockLayout,
  cardBodyContentH,
  HTML_BLOCK_DEFAULT_W,
  HTML_BLOCK_MIN_H,
  boxSubtitleH,
  wrapLineCount,
  naturalSize,
  CARD_WIDTH,
  EDGE_LABEL_SIZE_MAX,
  EDGE_LABEL_SIZE_MIN,
  LUCIDE_GLYPH_NAMES,
  lucideGlyphName,
  softBreakPieces,
  insideTitleMetrics,
  isInsideTitlePos,
  cardLabelFont,
  insideTitleFont,
  logoIconSlot,
  logoCaptionFont,
  logoIconRect,
  LOGO_CAPTION_MAX_FONT,
  cardGroupFonts,
  withCardFont,
  CARD_LABEL_MIN_FONT,
  CARD_LABEL_MAX_FONT,
  BOX_TITLE_MIN_FONT,
  BOX_TITLE_MAX_FONT,
} from "../src/demo_prompt_generator/ui/lib/platform-architecture";

// --- test helpers -----------------------------------------------------------

/** Build the minimal ReactFlow-internal node shape the layout passes read. */
const node = (x: number, y: number, w: number, h: number) => ({
  internals: { positionAbsolute: { x, y }, handleBounds: { source: null, target: null } },
  measured: { width: w, height: h },
});

type Lookup = Map<string, ReturnType<typeof node>>;
const lookup = (spec: Record<string, [number, number, number, number]>): Lookup => {
  const m: Lookup = new Map();
  for (const [id, [x, y, w, h]] of Object.entries(spec)) m.set(id, node(x, y, w, h));
  return m;
};

type Rect = { x: number; y: number; w: number; h: number };
/** The pill's real box — from the shared `label-chip` module, NOT a local copy,
 *  so a metric change can't quietly invalidate these assertions. */
const chipRect = (cx: number, cy: number, label: string): Rect => {
  const { w, h } = measureLabel(label);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};
const overlaps = (a: Rect, b: Rect, tol = 0): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol;
const rectOfNode = (l: Lookup, id: string): Rect => {
  const n = l.get(id)!;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width!, h: n.measured.height! };
};

/** Resolve an edge's final label rect the way FlowEdge does: router anchor +
 *  the de-confliction offset. */
function labelRectOf(
  edges: Parameters<typeof computeLabelOffsets>[0],
  l: Lookup,
  id: string,
): Rect {
  const e = edges.find((x) => x.id === id)!;
  const offsets = computeLabelOffsets(edges, l as never);
  const shift = offsets.get(id)!;
  // The anchor comes from the same shared geometry FlowEdge uses.
  const { computeFanLayout } = require("../src/demo_prompt_generator/ui/components/project/platform-diagram/fan-layout");
  const fan = computeFanLayout(edges as never, l as never).get(id);
  const dp = drawnPath(fan, rectOfNode(l, e.source), rectOfNode(l, e.target), e.data?.shape ?? "smooth", e.data?.centerX);
  return chipRect(dp.labelX + shift.dx, dp.labelY + shift.dy, String(e.label));
}

/** Tiles an edge's FINAL routed path runs through, excluding its own endpoints —
 *  the same measurement `inspect-arch` makes in the browser. */
function crossedBy(
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[],
  l: Lookup,
  id: string,
): string[] {
  const e = edges.find((x) => x.id === id)!;
  const fan = computeFanLayout(edges as never, l as never).get(id)!;
  const nodes = [...l.keys()].map((nid) => ({ id: nid, r: rectOfNode(l, nid) }));
  const { tiles } = partitionNodes(nodes);
  const poly = pathToPolyline(drawnPath(fan, rectOfNode(l, e.source), rectOfNode(l, e.target)).path);
  return tilesCrossed(poly, tiles, new Set([e.source, e.target]));
}

const fanOf = (
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[],
  l: Lookup,
  id: string,
) => computeFanLayout(edges as never, l as never).get(id)!;

let passed = 0;
/** A node anywhere in a (nested) node list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const findDeep = (ns: any[] | undefined, id: string): any => { for (const n of ns ?? []) { if (n.id === id) return n; const x = findDeep(n.children, id); if (x) return x; } };

const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`\n✗ ${name}`);
    throw err;
  }
};

// --- edge-geometry ----------------------------------------------------------

test("stubOffset caps at 20 for well-separated tiles", () => {
  assert.equal(stubOffset("r", "l", { x: 0, y: 0 }, { x: 500, y: 0 }), 20);
});

test("stubOffset shrinks so close tiles don't S-wiggle", () => {
  // 30px gap → 40% = 12, well under the 20px default that would overshoot.
  assert.equal(stubOffset("r", "l", { x: 0, y: 0 }, { x: 30, y: 0 }), 12);
  // Never collapses to zero, however tight.
  assert.equal(stubOffset("r", "l", { x: 0, y: 0 }, { x: 1, y: 0 }), 4);
});

test("stubOffset uses the FACING axis only", () => {
  // Vertical sides, small y-gap → shrinks on y even though x is far apart.
  assert.equal(stubOffset("b", "t", { x: 0, y: 0 }, { x: 900, y: 20 }), 8);
  // Mixed sides have no single facing axis → full stub.
  assert.equal(stubOffset("r", "t", { x: 0, y: 0 }, { x: 5, y: 5 }), 20);
});

test("guardCenterX pushes an elbow out of both stubs", () => {
  // Elbow requested INSIDE the source stub → pushed past it.
  assert.equal(guardCenterX(2, "r", "l", { x: 0, y: 0 }, { x: 400, y: 0 }, 20), 20);
  // Elbow requested past the target entry → pulled back before it.
  assert.equal(guardCenterX(999, "r", "l", { x: 0, y: 0 }, { x: 400, y: 0 }, 20), 380);
  // Comfortably inside the corridor → untouched.
  assert.equal(guardCenterX(200, "r", "l", { x: 0, y: 0 }, { x: 400, y: 0 }, 20), 200);
});

test("guardCenterX is a no-op for undefined and for vertical runs", () => {
  assert.equal(guardCenterX(undefined, "r", "l", { x: 0, y: 0 }, { x: 400, y: 0 }, 20), undefined);
  // A vertical run has no vertical elbow to guard.
  assert.equal(guardCenterX(5, "b", "t", { x: 0, y: 0 }, { x: 0, y: 400 }, 20), 5);
});

test("pathToPolyline parses M/L, collapses Q to its endpoint, drops duplicates", () => {
  assert.deepEqual(pathToPolyline("M0 0L100 0"), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  // Q's control point is NOT a vertex; only its end point is.
  assert.deepEqual(
    pathToPolyline("M0 0L 10,0Q 20,0 20,10L20 50"),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 50 }],
  );
  assert.deepEqual(pathToPolyline("M5 5L5 5L5 5"), [{ x: 5, y: 5 }]);
});

test("runAt reports the axis and extent of the run under a point", () => {
  const poly = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 }];
  const onH = runAt(poly, 100, 0);
  assert.equal(onH.horizontal, true);
  assert.deepEqual({ lo: onH.lo, hi: onH.hi }, { lo: 0, hi: 200 });
  const onV = runAt(poly, 200, 150);
  assert.equal(onV.horizontal, false);
  assert.deepEqual({ lo: onV.lo, hi: onV.hi }, { lo: 0, hi: 300 });
});

test("runAt MERGES collinear segments into the whole run", () => {
  // How the smooth-step router actually emits a straight run: stub, middle, stub.
  // Measuring one segment would report 60px of travel instead of the real 500.
  const poly = [{ x: 0, y: 28 }, { x: 20, y: 28 }, { x: 80, y: 28 }, { x: 500, y: 28 }];
  const r = runAt(poly, 250, 28);
  assert.equal(r.horizontal, true);
  assert.deepEqual({ lo: r.lo, hi: r.hi }, { lo: 0, hi: 500 });
});

test("runAt stops at a genuine corner", () => {
  // An L: the horizontal run must NOT absorb the vertical leg.
  const poly = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }];
  const r = runAt(poly, 50, 0);
  assert.deepEqual({ horizontal: r.horizontal, lo: r.lo, hi: r.hi }, { horizontal: true, lo: 0, hi: 200 });
});

test("drawnPath returns a path plus an anchor that sits between the endpoints", () => {
  const l = lookup({ a: [0, 0, 200, 56], b: [600, 0, 200, 56] });
  const fan = { sSide: "r" as const, tSide: "l" as const, sFrac: 0.5, tFrac: 0.5, centerX: undefined };
  const dp = drawnPath(fan, rectOfNode(l, "a"), rectOfNode(l, "b"));
  assert.ok(dp.path.startsWith("M"), "emits an SVG path");
  assert.deepEqual(dp.sp, { x: 200, y: 28 }, "exits the source's right edge at mid-height");
  assert.deepEqual(dp.tp, { x: 600, y: 28 }, "enters the target's left edge at mid-height");
  assert.ok(dp.labelX > 200 && dp.labelX < 600, "anchor lies in the gap");
});

// --- label-chip (wrapping + metrics) ---------------------------------------

test("a short label stays on one readable presentation line", () => {
  const m = measureLabel("Ingest");
  assert.deepEqual(m.lines, ["Ingest"]);
  assert.equal(m.h, LINE_H + CHIP_PAD_Y * 2, "pill height follows the shared font metrics");
});

test("a long label wraps on word boundaries and stays within the wrap width", () => {
  const label = "Write version, alias only on improvement";
  const lines = wrapLabel(label);
  assert.ok(lines.length > 1, "must wrap");
  // No line exceeds the wrap width, and no word was lost or split.
  for (const line of lines) assert.ok(line.length * CHAR_W <= MAX_TEXT_W, `line too wide: ${line}`);
  assert.equal(lines.join(" "), label, "wrapping must preserve the text exactly");
});

test("a chip can never be wider than the cap — the invariant that makes it placeable", () => {
  // The regression that motivated A2: this exact label was a ~234px single-line
  // chip on the mlops-v2 diagram, wider than the corridor it had to sit in, so no
  // offset could place it (measured: 4 violations → 0 once it wrapped). The
  // property that matters is the CAP, not a particular ratio — asserting a ratio
  // just re-encodes today's MAX_TEXT_W and breaks when it's tuned.
  const label = "Write version, alias on improvement";
  const single = label.length * CHAR_W + CHIP_PAD_X;
  const wrapped = measureLabel(label);
  assert.ok(single > 220, `precondition: the single-line chip was oversized (${single}px)`);
  assert.ok(wrapped.lines.length > 1, "must wrap");
  assert.ok(
    wrapped.w <= MAX_TEXT_W + CHIP_PAD_X,
    `wrapped chip must respect the cap (${wrapped.w} > ${MAX_TEXT_W + CHIP_PAD_X})`,
  );
  assert.ok(wrapped.w < single, "and be narrower than the unwrapped pill");
});

test("labels short enough to fit are not wrapped", () => {
  for (const label of ["Query gold tables", "Create/Modify Resources", "Model Registered Trigger"]) {
    assert.deepEqual(wrapLabel(label), [label], `${label} should not wrap`);
  }
});

test("wrapping clamps to MAX_LINES and marks itself clamped", () => {
  const long = "This label is far too long to fit inside a diagram pill and must be clamped somewhere sensible";
  const lines = wrapLabel(long);
  assert.equal(lines.length, MAX_LINES);
  assert.ok(lines[MAX_LINES - 1].endsWith("…"), "last line is ellipsized");
  assert.equal(isClamped(long), true, "clamped labels report it (so the pill adds a tooltip)");
  assert.equal(isClamped("Short"), false);
});

test("a single over-long word is never broken mid-word", () => {
  const lines = wrapLabel("catalog.schema.a_very_long_table_name_indeed");
  assert.deepEqual(lines, ["catalog.schema.a_very_long_table_name_indeed"]);
});

test("an empty label measures as nothing", () => {
  assert.deepEqual(wrapLabel("   "), []);
  assert.deepEqual(measureLabel(""), { lines: [], w: 0, h: 0 });
});

test("wrapped lines are stacked inside the chip without overlapping", () => {
  const m = measureLabel("Write version, alias only on improvement");
  const centres = m.lines.map((_, i) => lineCenterY(i, m.h));
  // Every line centre sits inside the chip, in order, one line-box apart.
  for (const c of centres) assert.ok(Math.abs(c) < m.h / 2, "line centre inside the chip");
  for (let i = 1; i < centres.length; i++) {
    assert.ok(centres[i] > centres[i - 1], "lines stack downward");
    assert.ok(centres[i] - centres[i - 1] >= 10, "lines don't overlap");
  }
});

// --- label-layout -----------------------------------------------------------

test("a clean anchor is left exactly where the router put it", () => {
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56] });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Ingest" }];
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.deepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 });
  assert.equal(off.leader, false, "no leader line when the label didn't move");
});

test("a label that would land on an unrelated tile is moved off it", () => {
  // `mid` is offset BELOW the line on purpose: the path itself misses it (so edge
  // avoidance leaves the route alone) but the label CHIP, which is taller than the
  // line, overlaps it. That isolates label placement. Put the tile back on the
  // line and the edge simply routes around it, making this test vacuous.
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56], mid: [400, 32, 100, 40] });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Stream changes" }];
  assert.deepEqual(crossedBy(edges, l, "e1"), [], "precondition: the LINE clears the tile");
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.notDeepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 }, "must not stay on the tile");
  // Assert a MATERIALLY clear label, not a pixel-perfect one. `label-layout`
  // deliberately treats a small clip as free (FREE_OVERLAP = 130px²) because
  // pricing a 1px nick as catastrophic is what made the solver fling labels across
  // the canvas and disagree with inspect-arch's own tolerance. Demanding zero
  // overlap here asserted the opposite of the design: this test went red the moment
  // edge labels grew 9.5px -> 11px (8010e8c) and the chosen slot began leaving a
  // 6.8x4px = 27px² corner clip — an eighth of the free allowance, and invisible.
  // Tolerance is per-AXIS, so it still catches a real cover-up.
  const rect = labelRectOf(edges, l, "e1");
  const tile = rectOfNode(l, "mid");
  assert.ok(!overlaps(rect, tile, 8), "final label rect must be materially clear of the tile");
  const ix = Math.min(rect.x + rect.w, tile.x + tile.w) - Math.max(rect.x, tile.x);
  const iy = Math.min(rect.y + rect.h, tile.y + tile.h) - Math.max(rect.y, tile.y);
  const area = ix > 0 && iy > 0 ? ix * iy : 0;
  assert.ok(area < 130, `residual overlap ${Math.round(area)}px² must stay inside the free allowance`);
});

test("clearing a tile prefers sliding ALONG the line over stepping off it", () => {
  // The chip is SANDWICHED: tiles just above and just below the line, so stepping
  // across is blocked in both directions and only an along-slide can work. The
  // line itself threads between them, so edge avoidance stays out of it — that's
  // what makes this a test of the along/across weighting rather than of routing.
  const l = lookup({
    a: [0, 0, 200, 56], b: [700, 0, 200, 56],
    above: [400, -40, 100, 38], below: [400, 32, 100, 60],
  });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Stream changes" }];
  assert.deepEqual(crossedBy(edges, l, "e1"), [], "precondition: the LINE threads between them");
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.notEqual(off.dx, 0, "slid along the horizontal run");
  // The POINT of this test is the along-vs-across weighting, so keep asserting the
  // slide. Clearance is material, not pixel-perfect — same FREE_OVERLAP rationale
  // as the test above; at 11px labels the chosen slot leaves a small corner clip
  // the solver is designed to accept.
  const r = labelRectOf(edges, l, "e1");
  assert.ok(!overlaps(r, rectOfNode(l, "above"), 8), "materially clears the tile above");
  assert.ok(!overlaps(r, rectOfNode(l, "below"), 8), "materially clears the tile below");
  // And it stayed ON its line rather than being flung across the canvas.
  assert.ok(Math.abs(off.dy) <= 26, `should not step far across: dy=${off.dy}`);
});

test("two edges between the SAME pair get non-overlapping labels", () => {
  // The fan separates the anchors, but by less than a chip height — so without
  // de-confliction the request/response labels sit on top of each other.
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56] });
  const edges = [
    { id: "e1", source: "a", target: "b", label: "Persist run history" },
    { id: "e2", source: "b", target: "a", label: "Read prior runs" },
  ];
  const r1 = labelRectOf(edges, l, "e1");
  const r2 = labelRectOf(edges, l, "e2");
  assert.ok(!overlaps(r1, r2), `labels must not overlap (got ${JSON.stringify(r1)} / ${JSON.stringify(r2)})`);
});

test("three edges converging on one target keep all three labels apart", () => {
  const l = lookup({
    s1: [0, 0, 180, 56], s2: [0, 120, 180, 56], s3: [0, 240, 180, 56],
    hub: [600, 110, 220, 80],
  });
  const edges = [
    { id: "e1", source: "s1", target: "hub", label: "Orders" },
    { id: "e2", source: "s2", target: "hub", label: "Shipments" },
    { id: "e3", source: "s3", target: "hub", label: "Returns" },
  ];
  const rects = ["e1", "e2", "e3"].map((id) => labelRectOf(edges, l, id));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlaps(rects[i], rects[j]), `labels ${i} and ${j} must not overlap`);
    }
  }
});

test("a label INSIDE a container box is not pushed out of it", () => {
  // `plat` encloses both tiles: it's a container, so only its TITLE strip blocks.
  const l = lookup({
    plat: [-40, -60, 900, 200], a: [0, 0, 200, 56], b: [600, 0, 200, 56],
  });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Curate" }];
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.deepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 }, "container body is not an obstacle");
});

test("a label on a container's TITLE strip is moved clear of it", () => {
  // `plat` must genuinely ENCLOSE both tiles, or it is classified as a plain tile
  // and this tests the wrong thing (whole-rect avoidance, not the title strip).
  // Its top is y=18, so the 34px strip is y 18–52 and the label anchor at y=48
  // lands on it.
  const l = lookup({
    plat: [-40, 18, 900, 300], a: [0, 20, 200, 56], b: [600, 20, 200, 56],
  });
  const nodes = [...l.keys()].map((id) => ({ id, r: rectOfNode(l, id) }));
  assert.deepEqual(
    partitionNodes(nodes).containers.map((c) => c.id), ["plat"],
    "precondition: plat is a CONTAINER",
  );
  const edges = [{ id: "e1", source: "a", target: "b", label: "Curate" }];
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.notDeepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 }, "title strip IS an obstacle");
});

test("resolveLabelAnchor: a U-turn keeps its label on the turn, beyond both ends", () => {
  // Bottom-to-bottom loop: the turn sits BELOW both endpoints by design.
  const r = resolveLabelAnchor({ x: 200, y: 120 }, { x: 100, y: 50 }, { x: 300, y: 50 }, "b", "b");
  assert.deepEqual(r, { x: 200, y: 120 }, "the turn's own label point is kept");
});

test("resolveLabelAnchor: a backward step whose elbow overshoots falls back to the endpoints' midpoint", () => {
  // Elbow pushed past the source's side: not a U-turn, so it is not kept out in the open.
  const r = resolveLabelAnchor({ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 300, y: 50 }, "r", "l");
  assert.deepEqual(r, { x: 200, y: 50 }, "falls back to the midpoint between the two ends");
});

test("resolveLabelAnchor: a label inside the endpoint span is unchanged", () => {
  const r = resolveLabelAnchor({ x: 150, y: 50 }, { x: 100, y: 50 }, { x: 300, y: 50 }, "r", "l");
  assert.deepEqual(r, { x: 150, y: 50 });
});

test("a U-turn loop's label sits on the turn, below both boxes, not floating between them", () => {
  // The retrain-loop case: both ends leave from the BOTTOM. The label must stay on the drawn
  // turn (below y=56), not drop to the midpoint between the two boxes.
  const l = lookup({ a: [0, 0, 200, 56], b: [400, 0, 200, 56] });
  const edges = [{ id: "loop", source: "a", target: "b", sourceHandle: "b", targetHandle: "b", label: "retrain" }];
  const r = labelRectOf(edges, l, "loop");
  assert.ok(r.y + r.h / 2 > 56, `the label centre must be on the turn below the boxes, got y=${r.y + r.h / 2}`);
});

test("a label STRADDLING a container border is moved fully inside or outside it", () => {
  // plat's RIGHT border (x=700) is where this edge's midpoint lands, so the anchor pill sits
  // astride it. Only plat's title strip used to be an obstacle, so the pill stayed on the line.
  const l = lookup({
    plat: [0, 100, 700, 300], a: [50, 150, 200, 56], b: [1150, 150, 200, 56],
  });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Curate" }];
  const plat = rectOfNode(l, "plat");
  const straddles = (r: Rect) =>
    Math.min(r.x + r.w, plat.x + plat.w) > Math.max(r.x, plat.x) &&
    Math.min(r.y + r.h, plat.y + plat.h) > Math.max(r.y, plat.y) &&
    !(r.x >= plat.x && r.x + r.w <= plat.x + plat.w && r.y >= plat.y && r.y + r.h <= plat.y + plat.h);
  // Precondition: the anchor itself (no de-confliction) really does straddle the border.
  const fan = fanOf(edges, l, "e1");
  const dp = drawnPath(fan, rectOfNode(l, "a"), rectOfNode(l, "b"));
  assert.ok(straddles(chipRect(dp.labelX, dp.labelY, "Curate")), "precondition: the anchor straddles plat's border");
  const r = labelRectOf(edges, l, "e1");
  assert.ok(!straddles(r), `the label must not straddle the border, got ${JSON.stringify(r)}`);
});

test("a label that merely sits INSIDE a container, clear of its border, is not moved", () => {
  // Border-only penalty: a pill fully inside the box is free, so the anchor stays put.
  const l = lookup({
    plat: [0, 100, 900, 300], a: [50, 150, 200, 56], b: [600, 150, 200, 56],
  });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Curate" }];
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.deepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 }, "a pill inside the box, away from its border, stays at the anchor");
});

test("a manually parked elbow is respected, and blocks auto labels", () => {
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56], c: [0, 100, 200, 56] });
  const edges = [
    // e1 is user-positioned: honoured exactly, never nudged.
    { id: "e1", source: "a", target: "b", label: "Manual placement", data: { centerX: 450 } },
    { id: "e2", source: "c", target: "b", label: "Auto placement" },
  ];
  const offsets = computeLabelOffsets(edges, l as never);
  assert.deepEqual(
    { dx: offsets.get("e1")!.dx, dy: offsets.get("e1")!.dy }, { dx: 0, dy: 0 },
    "a manual elbow must not be second-guessed",
  );
  assert.ok(
    !overlaps(labelRectOf(edges, l, "e1"), labelRectOf(edges, l, "e2")),
    "the auto label must route around the manual one",
  );
});

test("the result is independent of the incoming edge order", () => {
  const l = lookup({
    s1: [0, 0, 180, 56], s2: [0, 120, 180, 56], s3: [0, 240, 180, 56],
    hub: [600, 110, 220, 80], mid: [380, 130, 90, 40],
  });
  const mk = () => [
    { id: "e1", source: "s1", target: "hub", label: "Orders" },
    { id: "e2", source: "s2", target: "hub", label: "Shipments" },
    { id: "e3", source: "s3", target: "hub", label: "Returns" },
  ];
  const forward = mk();
  const reversed = mk().reverse();
  const a = computeLabelOffsets(forward, l as never);
  const b = computeLabelOffsets(reversed, l as never);
  for (const id of ["e1", "e2", "e3"]) {
    assert.deepEqual(
      { dx: a.get(id)!.dx, dy: a.get(id)!.dy },
      { dx: b.get(id)!.dx, dy: b.get(id)!.dy },
      `${id} must resolve identically regardless of array order`,
    );
  }
});

test("an unlabelled edge gets no entry", () => {
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56] });
  const edges = [{ id: "e1", source: "a", target: "b" }];
  assert.equal(computeLabelOffsets(edges, l as never).has("e1"), false);
});

test("a label boxed in on every side still resolves to the least-bad slot", () => {
  // Anchor surrounded by tiles: no clean slot exists. The pass must still return
  // a finite, bounded offset rather than falling back to the known-bad anchor.
  const l = lookup({
    a: [0, 100, 200, 56], b: [700, 100, 200, 56],
    o1: [380, 100, 120, 56], o2: [380, 20, 120, 56], o3: [380, 180, 120, 56],
  });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Boxed in completely" }];
  const off = computeLabelOffsets(edges, l as never).get("e1")!;
  assert.ok(Number.isFinite(off.dx) && Number.isFinite(off.dy), "offset must be finite");
  assert.ok(Math.abs(off.dx) <= 170, "along-slide stays bounded");
  assert.ok(Math.abs(off.dy) <= 34, "across-step stays tight");
  assert.notDeepEqual({ dx: off.dx, dy: off.dy }, { dx: 0, dy: 0 }, "moved off the fully-blocked anchor");
});

// --- edge/tile avoidance ----------------------------------------------------

test("segmentHitsRect catches a run passing clean through a rect", () => {
  const r = { x: 100, y: 0, w: 50, h: 100 };
  // Straight through, with NO endpoint inside — the case a sampled-point test misses.
  assert.equal(segmentHitsRect({ x: 0, y: 50 }, { x: 400, y: 50 }, r), true);
  assert.equal(segmentHitsRect({ x: 0, y: 500 }, { x: 400, y: 500 }, r), false);
  // Grazing the very edge doesn't count (inset).
  assert.equal(segmentHitsRect({ x: 0, y: 0 }, { x: 400, y: 0 }, r), false);
});

test("partitionNodes treats an enclosing box as a container, not a tile", () => {
  const nodes = [
    { id: "box", r: { x: 0, y: 0, w: 500, h: 300 } },
    { id: "a", r: { x: 20, y: 20, w: 100, h: 50 } },
    { id: "far", r: { x: 900, y: 0, w: 100, h: 50 } },
  ];
  const { tiles, containers } = partitionNodes(nodes);
  assert.deepEqual(containers.map((c) => c.id), ["box"]);
  assert.deepEqual(tiles.map((t) => t.id).sort(), ["a", "far"]);
});

test("an edge that would cross an unrelated tile is re-anchored to clear it", () => {
  // `mid` sits directly on the straight run from a to b.
  const l = lookup({
    a: [0, 100, 200, 56], b: [900, 100, 200, 56], mid: [420, 90, 120, 80],
  });
  const edges = [{ id: "e1", source: "a", target: "b" }];
  assert.deepEqual(crossedBy(edges, l, "e1"), [], "must not run through `mid`");
});

test("a clean edge is left exactly as the fan placed it", () => {
  const l = lookup({ a: [0, 100, 200, 56], b: [900, 100, 200, 56] });
  const edges = [{ id: "e1", source: "a", target: "b" }];
  const f = fanOf(edges, l, "e1");
  // Nothing in the way → default left-to-right anchors, no invented elbow.
  assert.deepEqual({ s: f.sSide, t: f.tSide }, { s: "r", t: "l" });
  assert.equal(f.centerX, undefined, "no gratuitous elbow on an already-clean edge");
});

test("a NAMED port is never moved, even to clear a tile", () => {
  // Same geometry, but the source leaves via a named composite port. That handle
  // fixes the anchor AND drives the flow animation, so avoidance must not
  // reassign it — even though moving it would clear `mid`.
  const l = lookup({
    a: [0, 100, 300, 120], b: [900, 100, 200, 56], mid: [420, 90, 120, 80],
  });
  const edges = [{ id: "e1", source: "a", target: "b", sourceHandle: "out-gold" }];
  const f = fanOf(edges, l, "e1");
  const portSide = fanOf([{ id: "x", source: "a", target: "b", sourceHandle: "out-gold" }], l, "x").sSide;
  assert.equal(f.sSide, portSide, "the named port's side must be preserved");
});

test("an unfixable edge is left untouched rather than moved to a different fault", () => {
  // The target is walled in by a FLUSH ring — four tiles touching its edges with no
  // gap, so every approach must cross one. (An earlier version of this test left a
  // 40px gap above the target, which the search correctly found, proving only that
  // the test was wrong.)
  const l = lookup({
    a: [0, 400, 200, 56],
    b: [900, 400, 120, 56],
    n: [800, 300, 320, 100],   // flush to b's top (y 300–400)
    s: [800, 456, 320, 100],   // flush to b's bottom
    w: [780, 300, 120, 256],   // flush to b's left
    e: [1020, 300, 120, 256],  // flush to b's right
  });
  const edges = [{ id: "e1", source: "a", target: "b" }];
  const withObstacles = fanOf(edges, l, "e1");
  // Same edge with the obstacles removed = the untouched baseline anchors.
  const bare = lookup({ a: [0, 400, 200, 56], b: [900, 400, 120, 56] });
  const baseline = fanOf([{ id: "e1", source: "a", target: "b" }], bare, "e1");
  assert.equal(withObstacles.sSide, baseline.sSide, "source side unchanged when nothing helps");
  assert.equal(withObstacles.tSide, baseline.tSide, "target side unchanged when nothing helps");
});

test("routing and labelling compose: the label lands on the RE-ROUTED path", () => {
  // `mid` blocks the line, so avoidance re-anchors the edge; the label must then be
  // placed against that new path and end up clear of everything.
  const l = lookup({ a: [0, 100, 200, 56], b: [900, 100, 200, 56], mid: [420, 90, 120, 80] });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Publish curated events" }];
  assert.deepEqual(crossedBy(edges, l, "e1"), [], "line clears the tile");
  assert.ok(
    !overlaps(labelRectOf(edges, l, "e1"), rectOfNode(l, "mid")),
    "and the label clears it too",
  );
});

test("avoidance is deterministic and order-independent", () => {
  const l = lookup({
    a: [0, 100, 200, 56], b: [900, 100, 200, 56], mid: [420, 90, 120, 80],
    c: [0, 300, 200, 56], d: [900, 300, 200, 56], mid2: [420, 290, 120, 80],
  });
  const mk = () => [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "c", target: "d" },
  ];
  const fwd = computeFanLayout(mk() as never, l as never);
  const rev = computeFanLayout(mk().reverse() as never, l as never);
  for (const id of ["e1", "e2"]) {
    const a = fwd.get(id)!, b = rev.get(id)!;
    assert.deepEqual(
      { s: a.sSide, t: a.tSide, cx: a.centerX },
      { s: b.sSide, t: b.tSide, cx: b.centerX },
      `${id} must resolve identically regardless of edge order`,
    );
  }
});

// --- the numbered-callout legend -------------------------------------------
// The on-canvas legend is DERIVED from the tab-level `legend` (never a node), so
// the two things that can break silently are its SIZE (the box clips its
// overflow) and its ROUND-TRIP (a derived node leaking into `nodes` would double
// the legend on every save). Both are pure, so assert them directly.

/** Wrap a flat file object as the fenced body parseArchitecture expects. */
const tab = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```\n";

test("legend items auto-number, keep explicit markers, and drop blanks", () => {
  const items = legendEntries({ items: ["first", "  ", { n: "D1", text: "databricks half" }, { text: "third" }] });
  assert.deepEqual(items.map((i) => i.n), ["1", "D1", "4"], "position-based numbering counts every entry");
  assert.deepEqual(items.map((i) => i.text), ["first", "databricks half", "third"]);
});

test("legend `show` gates each surface independently", () => {
  const items = ["a"];
  assert.equal(legendShows({ items }, "diagram"), false, "default (panel) draws no canvas box");
  assert.equal(legendShows({ items }, "panel"), true, "default fills the readable panel");
  assert.equal(legendShows({ items, show: "panel" }, "diagram"), false, "panel-only draws no box");
  // "diagram" means the canvas is its INTENDED home. The Legend panel is still
  // reachable for any legend (canvas.tsx gates the button on having entries, not
  // on `show`) — this flag only says where it's meant to be read.
  assert.equal(legendShows({ items, show: "diagram" }, "panel"), false, "`diagram` is not the panel's home");
  assert.equal(legendShows({ items: [] }, "panel"), false, "an empty legend shows nowhere");
});

test("legend box is sized TALL enough for its own text (it clips overflow)", () => {
  const font = 20;
  const one = legendBoxMetrics({ items: ["short"], fontSize: font }, 1200);
  const ten = legendBoxMetrics({ items: Array.from({ length: 10 }, () => "short"), fontSize: font }, 1200);
  assert.ok(ten.h > one.h, "more items → a taller box");
  // Every entry must get at least a full line box, plus padding and slack.
  assert.ok(ten.h >= 10 * font * 1.5, `10 lines at ${font}px need >= ${10 * font * 1.5}px, got ${ten.h}`);
  // A long entry WRAPS, so it reserves more than one line.
  const long = legendBoxMetrics({ items: ["w".repeat(400)], fontSize: font }, 900);
  assert.ok(long.h > one.h, "a wrapping entry reserves extra lines");
  // The box spans the diagram rather than shrinking to a minimum.
  assert.equal(legendBoxMetrics({ items: ["a"] }, 2400).w, 2400, "auto width follows the content width");
  assert.equal(legendBoxMetrics({ items: ["a"], width: 1000 }, 2400).w, 1000, "an explicit width wins");
});

test("legend renders as a derived node and NEVER serializes as one", () => {
  const file = {
    name: "t",
    legend: { title: "Key", show: "diagram" as const, items: ["one", "two"] },
    nodes: [{ id: "a", type: "genie", at: [0, 0] }, { id: "c1", type: "callout", text: "1", at: [-200, 0] }],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  const derived = schema.layout.nodes[LEGEND_NODE_ID];
  assert.ok(derived, "an on-canvas legend node is synthesized");
  assert.equal(derived.annotation?.variant, "box");
  assert.equal(derived.annotation?.vAlign, "top", "text starts at the top so a long legend reads first-line-first");
  assert.ok((derived.annotation?.fontSize ?? 0) >= 18, "legend prose is sized to survive being scaled to a slide");

  const out = serializeArchitecture(schema, schema.layout);
  const written = JSON.parse(out.replace(/```json\n|\n```\n?/g, ""));
  assert.equal(written.nodes.some((n: { id: string }) => n.id === LEGEND_NODE_ID), false, "the derived box is not a node");
  assert.deepEqual(written.legend, file.legend, "the legend round-trips verbatim");
  assert.equal(written.nodes.find((n: { id: string }) => n.id === "c1")?.type, "callout", "callouts round-trip as nodes");
  // A second pass must be byte-identical — a drifting legend would grow the file
  // on every autosave.
  const again = serializeArchitecture(parseArchitecture(out), parseArchitecture(out).layout);
  assert.equal(again, out, "save is stable across round-trips");
});

test("a multi-source group round-trips its first-class sources array + sizes with row count", () => {
  const sources = [
    { icon: "file:vendor/salesforce", label: "Salesforce", note: "CRM" },
    { icon: "text", label: "Workday", note: "staff SOR" },
  ];
  const file = {
    name: "t",
    nodes: [
      { id: "g", type: "multi-source", at: [0, 0], label: "SaaS apps", sources, params: { note: "vendor API" } },
    ],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  assert.ok(schema.layout.nodes["g"], "the group node resolves to a layout box");
  // The block sizes from its row count (2 rows here) + header + note line, and
  // grows with more rows.
  const two = multiSourceSize(sources, { note: "vendor API" });
  const five = multiSourceSize(Array.from({ length: 5 }, (_, i) => ({ icon: "text", label: `S${i}` })));
  assert.ok(two.h >= 84 && two.h <= 200, `2-row group has a compact height, got ${two.h}`);
  assert.ok(five.h > two.h, "more source rows → a taller box");
  assert.equal(multiSourceItems(sources).length, 2, "sources read back as the two systems");

  const out = serializeArchitecture(schema, schema.layout);
  const written = JSON.parse(out.replace(/```json\n|\n```\n?/g, ""));
  const g = written.nodes.find((n: { id: string }) => n.id === "g");
  assert.ok(g, "the group is a normal node (not derived/dropped)");
  assert.equal(g.type, "multi-source");
  assert.deepEqual(g.sources, sources, "the sources array survives serialize as first-class JSON");
  assert.equal(g.params.note, "vendor API");
  // A legacy JSON-string `params.items` still resolves (back-compat).
  assert.equal(multiSourceItems(undefined, { items: JSON.stringify(sources) }).length, 2, "legacy params.items still parses");
  // Stable across a second pass (no growth on autosave).
  const again = serializeArchitecture(parseArchitecture(out), parseArchitecture(out).layout);
  assert.equal(again, out, "save is stable across round-trips");
});

test("a multi-source `wrap` row grows the box + round-trips the flag", () => {
  const longNote = "student system of record — the canonical enrolment and records source, high write volume";
  const plain = [{ icon: "text", label: "SITS", note: longNote }];
  const wrapped = [{ icon: "text", label: "SITS", note: longNote, wrap: true }];
  // A wrap row reserves extra height for the note lines below the name.
  assert.ok(
    multiSourceSize(wrapped).h > multiSourceSize(plain).h,
    "a wrapped source note makes the box taller than the same note inline",
  );
  // The `wrap` flag survives serialize (it rides in the first-class sources array).
  const file = { name: "t", nodes: [{ id: "g", type: "multi-source", at: [0, 0], label: "Ops", sources: wrapped }], edges: [] };
  const out = serializeArchitecture(parseArchitecture(tab(file)), parseArchitecture(tab(file)).layout);
  const g = JSON.parse(out.replace(/```json\n|\n```\n?/g, "")).nodes.find((n: { id: string }) => n.id === "g");
  assert.equal(g.sources[0].wrap, true, "the wrap flag round-trips on the source item");
  // A plain item never gains a spurious wrap flag.
  assert.equal(multiSourceItems(plain)[0].wrap, undefined, "no wrap flag when not set");
});

test("a panel-only legend draws no canvas box", () => {
  const schema = parseArchitecture(tab({
    name: "t",
    legend: { show: "panel", items: ["one"] },
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.layout.nodes[LEGEND_NODE_ID], undefined, "nothing is drawn on the canvas");
  assert.equal(legendEntries(schema.legend).length, 1, "but the panel still has the sentences");
});

test("a legend with omitted `show` is panel-only", () => {
  const schema = parseArchitecture(tab({
    name: "t",
    legend: { items: ["one"] },
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.layout.nodes[LEGEND_NODE_ID], undefined, "the default never enlarges the image");
  assert.equal(legendShows(schema.legend, "panel"), true, "the prose remains available in the panel");
});

// --- actual presentation composition ----------------------------------------

test("presentation aspect assesses the authored node bounds, not padded export space", () => {
  const wide = assessPresentationAspect({
    aspect: "16:9",
    nodes: [
      { id: "a", type: "genie", at: [-350, 0], size: [200, 500] },
      { id: "b", type: "genie", at: [350, 0], size: [200, 500] },
    ],
    edges: [],
  });
  assert.ok(wide?.ok, `900×500 should be close to 16:9, got ${wide?.actual}`);

  // UNFRAMED, so the union IS the measured rectangle and a bare ribbon must still
  // fail — export tightly crops and cannot pad it into a slide shape.
  const ribbon = assessPresentationAspect({
    aspect: "16:9",
    nodes: [
      { id: "a", type: "genie", at: [-1000, 0], size: [200, 100] },
      { id: "b", type: "genie", at: [1000, 0], size: [200, 100] },
    ],
    edges: [],
  });
  assert.equal(ribbon?.ok, false, "an UNFRAMED one-row ribbon must not pass — export cannot pad it");
  assert.equal(ribbon?.framed, false, "no frame set → assessment reports the bare union");
});

// A ribbon is the CORRECT node shape once a frame supplies the other bands — the
// exemplar decks run 2.15-3.61:1 ribbons inside 1.77-1.91:1 canvases. Without
// this the gate pays authors to inflate gaps, which is the regression it caused.
test("frame: a tall title band composes a ribbon into an acceptable frame", () => {
  const nodes = [
    { id: "a", type: "genie" as const, at: [-900, 0] as [number, number], size: [200, 90] as [number, number] },
    { id: "b", type: "genie" as const, at: [900, 0] as [number, number], size: [200, 90] as [number, number] },
  ];
  const bare = assessPresentationAspect({ aspect: "16:9", nodes, edges: [] });
  assert.equal(bare?.ok, false, "precondition: the bare ribbon fails");

  const framed = assessPresentationAspect({
    aspect: "16:9",
    frame: { title: "Solution design", subtitle: "Reference architecture", titleFontSize: 300 },
    nodes,
    edges: [],
  });
  assert.equal(framed?.framed, true, "frame set → assessment measures the composed frame");
  assert.ok(
    framed!.actual < bare!.actual,
    `the frame band must reduce the measured ratio (bare ${bare!.actual.toFixed(2)} → framed ${framed!.actual.toFixed(2)})`,
  );
  // The ribbon's own ratio is reported but ADVISORY — never a fault.
  assert.ok((framed!.ribbon ?? 0) > 8, "ribbon ratio is recorded for reporting");
});

test("frame: title band is DERIVED — never serialized, no duplicate on round-trip", () => {
  const schema = parseArchitecture(tab({
    name: "T", aspect: "16:9", direction: "horizontal",
    frame: { title: "Data Products", subtitle: "Typical lifecycle" },
    columns: ["one"],
    nodes: [{ id: "a", type: "genie", col: "one", row: 1 }],
    edges: [],
  }));
  assert.ok(schema.layout.nodes[FRAME_TITLE_NODE_ID], "parse synthesizes the title band");
  assert.equal(schema.frame?.title, "Data Products", "frame round-trips on the schema");

  const once = serializeArchitecture(schema, schema.layout);
  const reparsed = parseArchitecture(once);
  const twice = serializeArchitecture(reparsed, reparsed.layout);
  assert.equal(once, twice, "parse→serialize must be byte-stable across two passes");

  const file = JSON.parse(once.replace(/```json\n|\n```\n?/g, "")) as { nodes?: { id: string }[]; frame?: { title?: string } };
  assert.equal(
    (file.nodes ?? []).some((n) => n.id === FRAME_TITLE_NODE_ID), false,
    "the derived band must NOT be written back as a node (else it doubles on autosave)",
  );
  assert.equal(file.frame?.title, "Data Products", "frame is re-emitted verbatim instead");
});

test("frame: show:false keeps frame measurement without rendering a band", () => {
  const schema = parseArchitecture(tab({
    name: "T", aspect: "16:9", direction: "horizontal",
    frame: { title: "Hidden", show: false },
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.layout.nodes[FRAME_TITLE_NODE_ID], undefined, "no band node when show:false");
  assert.equal(schema.frame?.show, false, "but the spec still round-trips");
});

test("technical is the default, and the node BOX is theme-invariant (slide changes only the inside)", () => {
  const schema = parseArchitecture(tab({
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.theme, "technical");
  // Slide is a pure visual skin: NO node resizes on a theme toggle — ordinary
  // tiles, sources, and composites all keep their natural (technical) footprint.
  // The box size comes from the catalog alone: a theme toggle never resizes a node.
  const sizesIn = (theme: "slide" | "technical") => {
    const boxes = computeLayout({
      theme, columns: ["a"],
      nodes: [
        { id: "g", type: "genie", col: "a", row: 0 },
        { id: "d", type: "databricks-agent", col: "a", row: 1 },
        { id: "s", type: "source", col: "a", row: 2, label: "Events", icon: "data" },
      ],
      edges: [],
    } as never);
    return ["g", "d", "s"].map((id) => ({ w: boxes.get(id)!.w, h: boxes.get(id)!.h }));
  };
  assert.deepEqual(sizesIn("slide"), sizesIn("technical"));
  assert.deepEqual(naturalSize("genie"), { w: 230, h: 54 });
});

test("slide theme round-trips while the default technical stays implicit", () => {
  const schema = parseArchitecture(tab({
    theme: "slide",
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.theme, "slide");
  assert.match(serializeArchitecture(schema, schema.layout), /"theme": "slide"/);
  // A diagram that declares no theme resolves to technical AND serializes it
  // back out with no `theme` field (the default stays implicit on disk).
  const implicit = parseArchitecture(tab({
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  assert.equal(implicit.theme, "technical");
  assert.doesNotMatch(serializeArchitecture(implicit, implicit.layout), /"theme"/);
});

test("vertical-caption source uses one footprint in symbolic and rendered geometry", () => {
  for (const theme of ["slide", "technical"] as const) {
    const body = tab({
      name: theme,
      aspect: "1:1",
      theme,
      columns: ["sources"],
      nodes: [
        { id: "a", type: "source", col: "sources", row: 0, caption: "bottom", label: "Incoming CSV", icon: "csv" },
        { id: "b", type: "source", col: "sources", row: 1, caption: "top", label: "Events", icon: "data" },
      ],
      edges: [],
    });
    const file = JSON.parse(body.replace(/```json\n|\n```\n?/g, ""));
    const boxes = computeLayout(file);
    const expected = verticalSourceSize();
    assert.deepEqual({ w: boxes.get("a")?.w, h: boxes.get("a")?.h }, expected);
    assert.deepEqual({ w: boxes.get("b")?.w, h: boxes.get("b")?.h }, expected);
    const component = { id: "source", label: "Incoming CSV", icon: "csv", desc: "", state: "active" as const };
    assert.deepEqual(nodeFootprint(component, { theme, sourceCaption: "bottom" }), expected, `${theme}:render`);
  }
});

test("rowGap is the actual clearance for slide and technical row grids", () => {
  for (const theme of ["slide", "technical"] as const) {
    const boxes = computeLayout({
      aspect: "1:1", theme, rowGap: 80, rowGrid: true, columns: ["main"],
      nodes: [
        { id: "a", type: "genie", col: "main", row: 0 },
        { id: "b", type: "genie", col: "main", row: 1 },
      ], edges: [],
    });
    const a = boxes.get("a")!, b = boxes.get("b")!;
    const clearance = b.y - b.h / 2 - (a.y + a.h / 2);
    assert.equal(clearance, 80, `${theme} gets the requested gap`);
  }
});

test("rowGap also controls auto-seeded wrapper stacks", () => {
  const separation = (rowGap: number) => {
    const boxes = computeLayout({
      aspect: "1:1", rowGap,
      nodes: [
        { id: "a", type: "genie" },
        { id: "b", type: "genie" },
        { id: "box", type: "box", wraps: ["a", "b"] },
      ], edges: [],
    });
    return boxes.get("b")!.y - boxes.get("a")!.y;
  };
  assert.equal(separation(96) - separation(20), 76);
  assert.equal(separation(240), separation(96), "oversized gaps clamp instead of stretching the canvas");
});

test("oversized rowGap is rejected as presentation-hostile", () => {
  const issues = validateArchitecture(tab({
    aspect: "16:9", direction: "horizontal", rowGap: 110,
    nodes: [{ id: "a", type: "genie", at: [-100, 0] }, { id: "b", type: "genie", at: [100, 0] }],
    edges: [],
  }));
  assert.ok(issues.some((i) => i.field === "rowGap" && i.message.includes("20–96")));
});

test("malformed row values are rejected and never create NaN coordinates", () => {
  const content = tab({
    aspect: "1:1", rowGrid: true, columns: ["main"],
    nodes: [
      { id: "a", type: "genie", col: "main", row: "1" },
      { id: "b", type: "genie", col: "main", row: 2 },
    ], edges: [],
  });
  assert.ok(validateArchitecture(content).some((i) => i.field === "row"));
  const file = JSON.parse(content.replace(/```json\n|\n```\n?/g, ""));
  for (const b of computeLayout(file).values()) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), "layout stays finite despite malformed input");
  }
});

test("rowGrid stacking is independent of node order (unnumbered stack below numbered)", () => {
  const nodes = [
    { id: "hdr", type: "text", text: "SERVE", col: "serve", row: 0 },
    { id: "pbi", type: "source", label: "Power BI", col: "serve", row: 1 },
    { id: "pbig", type: "source", label: "Power BI + Genie", col: "serve", row: 2 },
    { id: "aiml", type: "box", title: "AI/ML", col: "serve", size: [420, 120] },
    { id: "gw", type: "ai-gateway", col: "serve" },
  ];
  const base = { aspect: "16:9", direction: "horizontal", rowGrid: true, columns: ["serve"], edges: [] };
  const authored = computeLayout({ ...base, nodes });
  const sorted = computeLayout({ ...base, nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)) });
  for (const id of nodes.map((n) => n.id)) {
    assert.deepEqual(sorted.get(id), authored.get(id), `${id} moves when the file order changes`);
  }
  // and the unnumbered nodes really do sit BELOW the numbered ones
  const y = (id: string) => authored.get(id)!.y;
  assert.ok(y("aiml") > y("pbig") && y("gw") > y("aiml"), "unnumbered nodes stack under the last numbered row");
});

test("md format: bold/italic wrap the selection and toggle back off", () => {
  const v = "Declare: SDP pipelines";
  const on = applyMdFormat(v, 0, 7, "bold");
  assert.equal(on.value, "**Declare**: SDP pipelines");
  assert.equal(on.value.slice(on.start, on.end), "Declare", "selection stays on the word");
  const off = applyMdFormat(on.value, on.start, on.end, "bold");
  assert.equal(off.value, v, "second click removes it");
  // italic inside bold is independent, and doesn't eat the bold markers
  const both = applyMdFormat(on.value, on.start, on.end, "italic");
  assert.equal(both.value, "***Declare***: SDP pipelines");
  assert.equal(applyMdFormat(both.value, both.start, both.end, "italic").value, on.value);
});

test("md format: a caret expands to the word; an empty spot inserts a pair", () => {
  assert.equal(applyMdFormat("full refresh", 7, 7, "bold").value, "full **refresh**");
  const empty = applyMdFormat("a  b", 2, 2, "italic");
  assert.equal(empty.value, "a ** b");
  assert.equal(empty.start, 3);
});

test("md format: inline formats skip list/heading markers and go per line", () => {
  const v = "- Check: warn\n- Govern: ABAC";
  const r = applyMdFormat(v, 0, v.length, "bold");
  assert.equal(r.value, "- **Check: warn**\n- **Govern: ABAC**");
  assert.equal(applyMdFormat(r.value, r.start, r.end, "bold").value, v);
});

test("md format: bullet and title toggle whole lines and replace each other", () => {
  const v = "Declare\nCheck\n\nGovern";
  const b = applyMdFormat(v, 0, v.length, "bullet");
  assert.equal(b.value, "- Declare\n- Check\n\n- Govern", "blank lines are left alone");
  assert.equal(applyMdFormat(b.value, 0, b.value.length, "bullet").value, v);
  // only the touched line changes
  assert.equal(applyMdFormat(v, 9, 9, "heading").value, "Declare\n## Check\n\nGovern");
  // title on a bullet swaps the marker instead of stacking "## - "
  assert.equal(applyMdFormat("- Scale", 0, 0, "heading").value, "## Scale");
  assert.equal(applyMdFormat("## Scale", 0, 0, "bullet").value, "- Scale");
});

test("fan-out carries each sibling's dependents: a 2×2 grid stays a grid", () => {
  const card = (id: string, rel: Record<string, unknown>) => ({ id, type: "box", size: [200, 90], ...rel });
  const layout = computeLayout({
    aspect: "1:1", direction: "matrix", edges: [],
    nodes: [
      { id: "top", type: "box", size: [440, 60], at: [0, 0] },
      card("a", { below: "top", gap: 40 }),
      card("b", { below: "top", gap: 40 }),
      card("c", { below: "a", gap: 16 }),
      card("d", { below: "b", gap: 16 }),
    ],
  });
  const p = (id: string) => layout.get(id)!;
  assert.ok(p("a").x < p("b").x, "the two siblings fan out side by side");
  assert.equal(p("c").x, p("a").x, "c stays under a");
  assert.equal(p("d").x, p("b").x, "d stays under b");
  assert.equal(p("c").y, p("d").y, "second row stays level");
  assert.ok(Math.abs((p("a").x + p("b").x) / 2 - p("top").x) < 1, "the grid is centred under its anchor");
});

test("aspect and direction are required once a tab has a real architecture", () => {
  const issues = validateArchitecture(tab({
    nodes: [{ id: "a", type: "genie", at: [-100, 0] }, { id: "b", type: "genie", at: [100, 0] }],
    edges: [],
  }));
  assert.ok(issues.some((i) => i.field === "aspect" && i.message.includes("Missing required")));
  assert.ok(issues.some((i) => i.field === "direction" && i.message.includes("Missing required")));
});

test("presentation assessment includes a visible derived legend", () => {
  const assessed = assessPresentationAspect({
    aspect: "1:1",
    legend: { show: "diagram", at: [3000, 0], width: 240, items: ["Visible key"] },
    nodes: [
      { id: "a", type: "genie", at: [-100, -100], size: [100, 100] },
      { id: "b", type: "genie", at: [100, -100], size: [100, 100] },
      { id: "c", type: "genie", at: [-100, 100], size: [100, 100] },
      { id: "d", type: "genie", at: [100, 100], size: [100, 100] },
    ], edges: [],
  });
  assert.equal(assessed?.ok, false);
  assert.ok((assessed?.actual ?? 0) > 5, `legend must affect actual bounds: ${assessed?.actual}`);
});

test("solution flows default horizontal while square views default matrix", () => {
  const wide = parseArchitecture(tab({ aspect: "16:9", nodes: [{ id: "a", type: "genie" }], edges: [] }));
  const square = parseArchitecture(tab({ aspect: "1:1", nodes: [{ id: "a", type: "genie" }], edges: [] }));
  assert.equal(wide.direction, "horizontal");
  assert.equal(square.direction, "matrix");
  assert.match(serializeArchitecture(wide, wide.layout), /"direction": "horizontal"/);
  assert.match(serializeArchitecture(square, square.layout), /"direction": "matrix"/);
  const vertical = parseArchitecture(tab({ aspect: "16:9", direction: "vertical", nodes: [{ id: "a", type: "genie" }], edges: [] }));
  assert.match(serializeArchitecture(vertical, vertical.layout), /"direction": "vertical"/);
});

test("phase lanes pass: in-lane vertical steps don't count when cross-lane hand-offs read horizontal", () => {
  // The phase-lane idiom: each lane's 2-3 steps stack vertically UNDER ITS
  // BANNER while the flow advances horizontally BETWEEN lanes. Judging every
  // edge's axis failed this shape (it is the reference decks' banner pattern);
  // with declared columns only cross-lane edges speak for the reading direction.
  const columns = ["a", "b", "c", "d", "e"];
  const nodes = columns.flatMap((col) => [1, 4, 7].map((row) => ({ id: `${col}${row}`, type: "genie", col, row })));
  const edges = [
    ...columns.flatMap((col) => [
      { id: `${col}-1-4`, from: `${col}1`, to: `${col}4` },
      { id: `${col}-4-7`, from: `${col}4`, to: `${col}7` },
    ]),
    ...columns.slice(0, -1).map((col, i) => ({ id: `cross-${i}`, from: `${col}1`, to: `${columns[i + 1]}1` })),
  ];
  const file = { aspect: "16:9" as const, direction: "horizontal" as const, columns, rowGrid: true, rowGap: 110, nodes, edges };
  const assessed = assessFlowOrientation(file);
  assert.equal(assessed?.total, 4, "only the cross-lane edges are counted");
  assert.equal(assessed?.ok, true);
  assert.equal(assessed?.scoped, true);
  assert.equal(assessFlowOrientation({ ...file, direction: "matrix" }), null, "true comparison matrices opt out");
});

test("a vertical relationship set still fails horizontal when no lanes scope the count", () => {
  // No `columns` declared -> every edge counts (the pre-lane behaviour): a
  // mostly-vertical flow cannot call itself horizontal.
  const file = {
    aspect: "16:9" as const, direction: "horizontal" as const,
    nodes: [1, 2, 3, 4, 5, 6].map((r) => ({ id: `n${r}`, type: "genie", at: [0, r * 120] as [number, number] })),
    edges: [1, 2, 3, 4, 5].map((r) => ({ id: `e${r}`, from: `n${r}`, to: `n${r + 1}` })),
  };
  const assessed = assessFlowOrientation(file);
  assert.equal(assessed?.ok, false);
  assert.equal(assessed?.scoped, false);
  const issues = validateArchitecture(tab(file));
  assert.ok(issues.some((i) => i.field === "direction" && i.message.includes("relationships read horizontal")));
});

test("left-to-right stage flow passes horizontal orientation", () => {
  const file = {
    aspect: "16:9" as const, direction: "horizontal" as const,
    columns: ["a", "b", "c", "d", "e"],
    nodes: ["a", "b", "c", "d", "e"].map((col) => ({ id: col, type: "genie", col })),
    edges: ["a", "b", "c", "d"].map((from, i) => ({ id: `e${i}`, from, to: ["b", "c", "d", "e"][i] })),
  };
  assert.equal(assessFlowOrientation(file)?.ok, true);
});

test("presentation aspect round-trips; a ratio MISS is NOT a content fault", () => {
  const file = {
    name: "ribbon",
    aspect: "1:1" as const,
    rowGap: 90,
    nodes: [
      { id: "a", type: "genie", at: [-600, 0] as [number, number] },
      { id: "b", type: "genie", at: [600, 0] as [number, number] },
    ],
    edges: [],
  };
  const content = tab(file);
  const issues = validateArchitecture(content);
  // A wide ribbon declaring 1:1 is a big MISS — and that must NOT be a gated
  // content fault. The 16:9/1:1 target was reverse-engineered from cropped
  // screenshots, and gating it flagged a 2.15:1 ribbon identical in shape to the
  // reference slide we want to imitate. The real harms (tiny text, huge voids) are
  // measured as within-image proportions in inspect-arch's advisory block instead.
  assert.equal(
    issues.some((i) => i.field === "aspect"), false,
    "a ratio miss must not be reported as a content fault",
  );
  const assessed = assessPresentationAspect(file);
  assert.ok(assessed && !assessed.ok, "but the assessment itself still reports the miss for advisory use");
  const schema = parseArchitecture(content);
  assert.equal(schema.aspect, "1:1");
  const serialized = serializeArchitecture(schema, schema.layout);
  assert.match(serialized, /"aspect": "1:1"/);
  // An old file is migrated on parse and saved nested: lane-only fields are gone.
  assert.doesNotMatch(serialized, /"rowGap"/);
  assert.match(serialized, /"layout": "/);
});

// --- eval scoring ------------------------------------------------------------

test("the generic-label metric exempts legend MARKERS", () => {
  // complex-workflows.md Option 2 prescribes numbering the edges, so a marker must not score
  // as an uninformative label. The first version of this metric flagged all eight
  // edges of the numbered-legend corpus case for following the documented pattern.
  for (const marker of ["1", "7", "12", "D1", "D5", "3a"]) {
    assert.equal(isGenericLabel(marker), false, `${marker} is a legend key, not a lazy label`);
  }
});

test("the generic-label metric still catches labels that say nothing", () => {
  for (const bad of ["data", "Sync", "query", "events", "telemetry", "API", "x"]) {
    assert.equal(isGenericLabel(bad), true, `"${bad}" carries no information`);
  }
  // Short technical acronyms ARE meaningful and must survive.
  for (const ok of ["ETL", "CDC", "ACL", "Stream order events"]) {
    assert.equal(isGenericLabel(ok), false, `"${ok}" is meaningful`);
  }
});

// --- flowchart shapes --------------------------------------------------------

test("every shape kind draws a closed path inside its box", () => {
  for (const kind of SHAPE_KINDS) {
    for (const [w, h] of [[200, 90], [320, 64], [64, 64], [90, 200], [40, 24]] as const) {
      const stroke = 2;
      const d = shapePath(kind, { w, h, stroke });
      assert.ok(d.startsWith("M "), `${kind} ${w}x${h} starts with a moveto`);
      assert.ok(d.trimEnd().endsWith("Z"), `${kind} ${w}x${h} is closed (so fill works)`);
      assert.ok(!/NaN|Infinity|undefined/.test(d), `${kind} ${w}x${h} has no degenerate numbers: ${d}`);
      // Every coordinate must sit within the node box, inset by the half-stroke
      // the module promises — otherwise the border is clipped by the viewport.
      const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      // Path commands here are all absolute x,y pairs (M/L/Q/A land on pairs at
      // the end of each command), so check the extremes rather than parse arcs.
      const inset = stroke / 2;
      for (const v of nums) {
        assert.ok(v >= -0.01, `${kind} ${w}x${h} has no negative coordinate (${v})`);
        assert.ok(v <= Math.max(w, h) - inset + 0.01, `${kind} ${w}x${h} stays inside the box (${v})`);
      }
    }
  }
});

test("the lib-layer shape validator accepts EVERY kind the renderer can draw", () => {
  // platform-architecture.ts keeps its own runtime SHAPE_KIND_SET (the lib layer
  // must not import the component layer) and the parse path drops an unknown kind
  // to "rounded" — a kind missing from that set renders as the WRONG SHAPE with no
  // error (this is exactly how "chevron" first shipped: it drew a rounded rect).
  // The set's comment claims this test keeps them in step; it must actually exist.
  for (const kind of SHAPE_KINDS) {
    assert.ok(isShapeKind(kind), `isShapeKind("${kind}") — add it to SHAPE_KIND_SET`);
  }
  // …and the reverse, so a kind isn't left validating that the renderer can't draw.
  for (const kind of ["rectangle", "rounded", "ellipse", "diamond", "triangle",
    "parallelogram", "hexagon", "cylinder", "document", "chevron"] as const) {
    assert.ok((SHAPE_KINDS as readonly string[]).includes(kind), `SHAPE_KINDS missing "${kind}"`);
  }
});

test("chevron points ONE way, so a row of them reads as a sequence", () => {
  // The distinguishing property vs `hexagon`: a hexagon is symmetric (both ends cut
  // inward, reading as one self-contained "preparation" step), whereas a chevron's
  // RIGHT end is a point and its LEFT end is a matching notch — which is what makes
  // "Data Preparation › Training › Inference" interlock and read as a flow.
  const w = 380, h = 64;
  const d = shapePath("chevron", { w, h });
  const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const cy = h / 2;
  // exactly one vertex at the far right, and it sits on the vertical centre (the point)
  const right = pts.filter((p) => Math.abs(p[0] - w) < 0.01);
  assert.equal(right.length, 1, `one rightmost vertex, got ${right.length}`);
  assert.ok(Math.abs(right[0][1] - cy) < 0.01, "the point is on the vertical centre");
  // the left edge is a NOTCH: two vertices at x=0 (top+bottom) plus one inset at cy
  const left = pts.filter((p) => Math.abs(p[0]) < 0.01);
  assert.equal(left.length, 2, `two vertices on the left edge, got ${left.length}`);
  const notch = pts.find((p) => p[0] > 0 && p[0] < w / 2 && Math.abs(p[1] - cy) < 0.01);
  assert.ok(notch, "a notch vertex sits inset from the left edge on the centre line");
  // asymmetry is the whole point — a hexagon of the same box is NOT the same path
  assert.notEqual(d, shapePath("hexagon", { w, h }), "chevron must differ from hexagon");

  // The point stays a shallow arrow on a wide banner rather than a spike: capped at
  // CHEV_MAX (32px), so a 380px header gets ~27px of point, not 190px.
  assert.ok(w - right[0][0] === 0, "point reaches the right edge");
  const inset = notch![0];
  assert.ok(inset > 0 && inset <= 32.01, `notch inset is capped (got ${inset})`);

  // Text must clear BOTH ends or a centred phase label collides with the geometry.
  const ins = shapeTextInset("chevron", { w, h });
  assert.ok(ins.left > ins.top && ins.right > ins.top, "both ends inset more than top/bottom");
});

test("a shape's stroke is inset so the border isn't clipped", () => {
  // The rectangle is the clearest case: with a 4px stroke the outline must start
  // 2px in on every side, not at 0.
  const d = shapePath("rectangle", { w: 100, h: 50, stroke: 4 });
  assert.equal(d, "M 2 2 L 98 2 L 98 48 L 2 48 Z");
  // No stroke → no inset (the shape fills its box exactly).
  assert.equal(shapePath("rectangle", { w: 100, h: 50 }), "M 0 0 L 100 0 L 100 50 L 0 50 Z");
});

test("a diamond is a diamond at any aspect ratio", () => {
  // Points must be the four edge midpoints — the property that makes it read as
  // a decision symbol rather than a squashed box.
  assert.equal(shapePath("diamond", { w: 200, h: 100 }), "M 100 0 L 200 50 L 100 100 L 0 50 Z");
  assert.equal(shapePath("diamond", { w: 60, h: 240 }), "M 30 0 L 60 120 L 30 240 L 0 120 Z");
});

test("pointed shapes reserve room so their label stays inside the outline", () => {
  const box = { w: 200, h: 100 };
  // A diamond/triangle MUST pad more than a rectangle: text drawn edge-to-edge
  // would sit outside the sloped sides (the reason this helper exists).
  const rect = shapeTextInset("rectangle", box);
  for (const kind of ["diamond", "triangle", "parallelogram", "hexagon", "cylinder"] as const) {
    const pad = shapeTextInset(kind, box);
    const wider = pad.left > rect.left || pad.top > rect.top || pad.bottom > rect.bottom;
    assert.ok(wider, `${kind} reserves more room than a plain rectangle`);
  }
  // A triangle's usable area is the BOTTOM half (the apex is unusable).
  const tri = shapeTextInset("triangle", box);
  assert.ok(tri.top > box.h * 0.4, "a triangle keeps its label below the apex");
  // Insets must never eat the whole box, or the label would have zero width.
  for (const kind of SHAPE_KINDS) {
    const p = shapeTextInset(kind, box);
    assert.ok(p.left + p.right < box.w, `${kind} leaves horizontal room for text`);
    assert.ok(p.top + p.bottom < box.h, `${kind} leaves vertical room for text`);
  }
});

test("every shape kind is labelled for the palette + picker", () => {
  // A kind with no label would render a blank palette row.
  for (const kind of SHAPE_KINDS) {
    assert.ok(SHAPE_LABEL[kind] && SHAPE_LABEL[kind].length > 1, `${kind} has a human label`);
  }
  assert.ok(SHAPE_KINDS.includes(DEFAULT_SHAPE_KIND), "the default kind is a real kind");
});

test("a shape node round-trips through the file format", () => {
  const out = serializeArchitecture(...(() => {
    const s = parseArchitecture(tab({
      name: "flow",
      nodes: [
        { id: "s1", type: "shape", shape: "ellipse", at: [0, 0], text: "Start" },
        { id: "s2", type: "shape", shape: "diamond", at: [240, 0], text: "Approved?" },
        // No explicit kind → the default, and it must SURVIVE as the default.
        { id: "s3", type: "shape", at: [480, 0], text: "Publish" },
      ],
      edges: [{ from: "s1", to: "s2", label: "Submit" }, { from: "s2", to: "s3", label: "Yes" }],
    }));
    return [s, s.layout] as const;
  })());
  const written = JSON.parse(out.replace(/```json\n|\n```\n?/g, ""));
  const byId = (id: string) => written.nodes.find((n: { id: string }) => n.id === id);
  assert.equal(byId("s1").type, "shape", "a shape stays a shape");
  assert.equal(byId("s1").shape, "ellipse", "the kind round-trips");
  assert.equal(byId("s2").shape, "diamond");
  assert.equal(byId("s2").text, "Approved?", "the label round-trips");
  assert.equal(byId("s3").shape, "rounded", "an unset kind resolves to the default");
  // Stability: a second pass must not drift (the autosave-growth failure mode).
  const again = serializeArchitecture(parseArchitecture(out), parseArchitecture(out).layout);
  assert.equal(again, out, "save is stable across round-trips");
});

test("an unknown shape kind is reported, not silently swallowed", () => {
  const issues = validateArchitecture(tab({
    name: "flow",
    nodes: [
      { id: "bad", type: "shape", shape: "octagon" as never, at: [0, 0] },
      { id: "wrong", type: "box", shape: "diamond" as never, at: [200, 0] },
    ],
    edges: [],
  }));
  assert.ok(issues.some((i) => i.nodeId === "bad" && i.field === "shape"), "a bad kind is flagged");
  assert.ok(issues.some((i) => i.nodeId === "wrong" && i.field === "shape"), "shape on a non-shape node is flagged");
  // But it still PARSES (falling back), so one typo can't blank the tab.
  const schema = parseArchitecture(tab({
    name: "flow",
    nodes: [{ id: "bad", type: "shape", shape: "octagon" as never, at: [0, 0] }],
    edges: [],
  }));
  assert.equal(schema.layout.nodes["bad"]?.annotation?.shape, "rounded", "falls back to the default kind");
});

// --- manual label placement -------------------------------------------------

const STRAIGHT = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

test("a distance from the source resolves to that point", () => {
  const a = labelAnchorAt(STRAIGHT, { d: 40, from: "source" })!;
  assert.equal(a.x, 40);
  assert.equal(a.y, 0);
});

test("a distance from the target measures backwards", () => {
  const a = labelAnchorAt(STRAIGHT, { d: 30, from: "target" })!;
  assert.equal(a.x, 70);
});

test("the anchor is clamped off the endpoint stubs", () => {
  // A chip over a port anchor is unreadable and laps the tile it attaches to.
  assert.ok(labelAnchorAt(STRAIGHT, { d: 0, from: "source" })!.x > 0);
  assert.ok(labelAnchorAt(STRAIGHT, { d: 0, from: "target" })!.x < 100);
});

test("off moves across the line, never along it", () => {
  const a = labelAnchorAt(STRAIGHT, { d: 50, from: "source", off: 10 })!;
  assert.equal(a.x, 50, "perpendicular offset must not shift the along-distance");
  assert.equal(a.y, 10);
});

test("a dragged point round-trips through {d, from, off}", () => {
  const got = labelPosFromPoint(STRAIGHT, 30, -12);
  assert.equal(got.from, "source", "30 of 100 is nearer the source");
  assert.equal(got.d, 30);
  assert.equal(got.off, -12);
  const back = labelAnchorAt(STRAIGHT, got)!;
  assert.ok(Math.abs(back.x - 30) < 0.01 && Math.abs(back.y + 12) < 0.01,
    `round trip drifted to ${back.x},${back.y}`);
});

test("a drop past the midpoint anchors to the TARGET end", () => {
  // On a path long enough that the end margin doesn't bite (STRAIGHT is only 100px
  // and the margin is 24, so a drop at 80 legitimately clamps to 76).
  const LONG = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
  const got = labelPosFromPoint(LONG, 300, 0);
  assert.equal(got.from, "target", "300 of 400 is nearer the target");
  assert.equal(got.d, 100);
});

test("a manual label does NOT move when the far end moves", () => {
  // The bug this anchoring exists to fix. A fraction is a proportion of total
  // length, so lengthening the path slides the chip: t=0.4 sat at x=400 on a 500px
  // path and x=480 once the target moved 200px right. Every manual label in the
  // diagram drifted whenever ANY node moved. An absolute distance from the nearer
  // end is invariant under growth at the other end.
  const shortPath = [{ x: 0, y: 0 }, { x: 500, y: 0 }];
  const longPath = [{ x: 0, y: 0 }, { x: 700, y: 0 }];
  const pos = labelPosFromPoint(shortPath, 200, 0);
  assert.equal(pos.from, "source");
  const before = labelAnchorAt(shortPath, pos)!;
  const after = labelAnchorAt(longPath, pos)!;
  assert.equal(before.x, after.x, "the chip must not move when the far end does");

  // And the legacy fractional form demonstrably DOES move — kept as a check that
  // back-compat still resolves, and as the record of why it was replaced.
  const fx = labelAnchorAt(shortPath, { t: 0.4 })!.x;
  const fy = labelAnchorAt(longPath, { t: 0.4 })!.x;
  assert.notEqual(fx, fy);
});

test("an anchor travels round a corner so the label stays on its line", () => {
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const a = labelAnchorAt(L, { d: 150, from: "source" })!;
  assert.ok(Math.abs(a.x - 100) < 0.01 && a.y > 40, `expected the vertical leg: ${a.x},${a.y}`);
});

test("the legacy fractional form still resolves", () => {
  const a = labelAnchorAt(STRAIGHT, { t: 0.5 })!;
  assert.equal(a.x, 50);
  const [lo, hi] = labelTBounds(100);
  assert.ok(lo > 0 && hi < 1);
});

// --- Edge round trip: flow -> layout -> flow --------------------------------
// Manual edge properties are carried by FOUR separate pieces of code: two
// serialisers in platform-architecture, schemaToFlow (load), and flowToLayout
// (save). Any one of them omitting a field breaks persistence, and the failure
// looks like the feature working until something ELSE triggers a save — because a
// node move re-seeds every edge from the schema. flowToLayout silently dropped
// labelPos, bezier, controlPoints AND waypoints, which is what made a manual label
// "stay, then move again" the moment any node was dragged. Assert the whole trip.

test("the SAVE path carries every manual edge property", () => {
  // flow-mapping can't be imported here (it pulls in file-icons, which needs
  // Vite's import.meta.glob), so this asserts the field list flowToLayout emits by
  // reading the source. Crude, but it pins the exact regression: the save path had
  // four persisted fields missing, and no test could see it because every existing
  // test exercised only the READ side.
  const src = readFileSync(
    new URL("../src/demo_prompt_generator/ui/components/project/platform-diagram/flow-mapping.ts", import.meta.url),
    "utf8",
  );
  // The whole `eds.map(...)` callback: from `const layoutEdges` to the `});` that
  // closes it. (Slicing at the first `return {` stops INSIDE the callback, before
  // any of the fields — which is how the first version of this test passed
  // vacuously.)
  const body = src.slice(src.indexOf("const layoutEdges"));
  const save = body.slice(0, body.indexOf("  });"));
  for (const field of ["labelPos", "centerX", "bezier", "controlPoints", "waypoints"]) {
    assert.ok(
      save.includes(`{ ${field}:`) || save.includes(`${field}: ed.${field}`),
      `flowToLayout must persist ${field} — omitting it silently resets the property on the next save`,
    );
  }
});

test("a saved labelPos comes back through a load", () => {
  // The other half: serialise a tab carrying labelPos, re-parse it, and check the
  // value reaches the layout the canvas seeds from.
  const schema = parseArchitecture(tab({
    name: "reload",
    nodes: [
      { id: "a", type: "text", text: "A", at: [0, 0] },
      { id: "b", type: "text", text: "B", at: [400, 0] },
    ],
    edges: [{
      id: "e1", from: "a", to: "b", label: "Approved only",
      labelPos: { d: 90, from: "source", off: 12 },
    }],
  }));
  const e = schema.layout.edges.find((x) => x.id === "e1")!;
  assert.deepEqual(e.labelPos, { d: 90, from: "source", off: 12 });
});

// --- step 2.5: lane-uniform width for VERTICAL captions and PINNED nodes ------

test("a lane of bottom-caption logos is widened to the widest, pinned or not", () => {
  // The defect: a vertical logo's width is max(icon, caption, desc) + pad and the
  // render CENTRES the icon in it, so caption length sets the tile width and every
  // edge terminating on that border lands a different distance from the icon.
  // Measured on a real file: 139 / 176 / 204px in ONE lane.
  //
  // Both cases below must normalise. PINNED matters most — that is where
  // hand-composed slides live, and the horizontal pass deliberately skips them
  // because it also moves `box.x`. The vertical pass moves nothing, so it can
  // include them.
  const lane = (pinned: boolean) => {
    const at = (y: number) => (pinned ? { at: [500, y] } : { col: "lane", row: y / 100 });
    return tab({
      name: pinned ? "pinned lane" : "symbolic lane",
      ...(pinned ? {} : { columns: ["lane"] }),
      nodes: [
        { id: "a", type: "logo", icon: "dbCatalog", text: "Dev", caption: "bottom", ...at(100) },
        { id: "b", type: "logo", icon: "dbCatalog", text: "Staging", caption: "bottom", ...at(200) },
        { id: "c", type: "logo", icon: "dbCatalog", text: "Production Workspace", caption: "bottom", ...at(300) },
      ],
      edges: [],
    });
  };
  for (const pinned of [false, true]) {
    const boxes = computeLayout(JSON.parse(
      lane(pinned).replace(/```json\n|\n```\n?/g, ""),
    ) as never);
    const ws = ["a", "b", "c"].map((id) => boxes.get(id)!.w);
    assert.equal(
      new Set(ws).size, 1,
      `${pinned ? "pinned" : "symbolic"} lane must share one width, got ${ws.join("/")}`,
    );
    // Widened to the WIDEST, never shrunk to the narrowest — shrinking would clip
    // the longest caption, which is a worse fault than uneven joins.
    assert.equal(Math.max(...ws), ws[2], "the widest member sets the lane width");
    if (pinned) {
      // The author's coordinates are untouched: this pass sets width only.
      for (const id of ["a", "b", "c"]) assert.equal(boxes.get(id)!.x, 500, `${id} must not move`);
    }
  }
});

test("an explicit size opts a logo OUT of lane-uniform widening", () => {
  // `size` is the documented escape hatch. Silently widening it would make it
  // unusable, so an explicit size participates in the max but is never overwritten.
  const boxes = computeLayout(JSON.parse(tab({
    name: "explicit",
    nodes: [
      { id: "a", type: "logo", icon: "dbCatalog", text: "Dev", caption: "bottom", at: [500, 100] },
      { id: "b", type: "logo", icon: "dbCatalog", text: "A much longer caption", caption: "bottom", at: [500, 200] },
      { id: "c", type: "logo", icon: "dbCatalog", text: "Fixed", caption: "bottom", size: [111, 88], at: [500, 300] },
    ],
    edges: [],
  }).replace(/```json\n|\n```\n?/g, "")) as never);
  assert.equal(boxes.get("c")!.w, 111, "an explicit size is honoured verbatim");
  assert.equal(boxes.get("a")!.w, boxes.get("b")!.w, "the others still normalise");
});

test("logos in DIFFERENT columns are not merged into one group", () => {
  // Grouping is by shared centre x (8px tolerance) so it can see a pinned slide,
  // which has no `col`. That must not collapse two genuinely separate columns into
  // one width — the guard is the tolerance, and this pins it.
  const boxes = computeLayout(JSON.parse(tab({
    name: "two columns",
    nodes: [
      { id: "l1", type: "logo", icon: "dbCatalog", text: "Dev", caption: "bottom", at: [300, 100] },
      { id: "l2", type: "logo", icon: "dbCatalog", text: "Prod", caption: "bottom", at: [300, 200] },
      { id: "r1", type: "logo", icon: "dbCatalog", text: "A very long right caption", caption: "bottom", at: [900, 100] },
      { id: "r2", type: "logo", icon: "dbCatalog", text: "Also long over here", caption: "bottom", at: [900, 200] },
    ],
    edges: [],
  }).replace(/```json\n|\n```\n?/g, "")) as never);
  assert.equal(boxes.get("l1")!.w, boxes.get("l2")!.w, "left column shares a width");
  assert.equal(boxes.get("r1")!.w, boxes.get("r2")!.w, "right column shares a width");
  assert.ok(
    boxes.get("r1")!.w > boxes.get("l1")!.w,
    "the two columns keep their OWN widths — grouping is per column, not global",
  );
});

test("a lone bottom-caption logo keeps its natural width", () => {
  const boxes = computeLayout(JSON.parse(tab({
    name: "lone",
    nodes: [{ id: "only", type: "logo", icon: "dbCatalog", text: "Solo", caption: "bottom", at: [500, 100] }],
    edges: [],
  }).replace(/```json\n|\n```\n?/g, "")) as never);
  const natural = logoFootprint(60, 60, { caption: "bottom", text: "Solo", fontSize: 15 }).w;
  assert.equal(boxes.get("only")!.w, natural, "nothing to align against, so nothing changes");
});

test("the logo icon constant matches between the lib and the render", () => {
  // `platform-architecture.ts` MEASURES a logo's footprint from its own copy of
  // the default logo size, while `annotations.tsx` DRAWS from another. They were
  // 64 and 60: the measured box was 4px wider than the drawn icon on every
  // captioned logo, and nothing pinned them together. Whatever the value, the two
  // must agree, or layout reserves space the render doesn't use.
  const read = (path: string): { w: number; h: number } => {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const m = src.match(/logo:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/);
    assert.ok(m, `could not find the logo default size in ${path}`);
    return { w: Number(m![1]), h: Number(m![2]) };
  };
  const lib = read("../src/demo_prompt_generator/ui/lib/platform-architecture.ts");
  const render = read("../src/demo_prompt_generator/ui/components/project/platform-diagram/annotations.tsx");
  assert.deepEqual(
    lib, render,
    "ANNOTATION_SIZE.logo (lib, used to MEASURE) must equal "
    + "ANNOTATION_DEFAULT_SIZE.logo (render, used to DRAW)",
  );
});

// --- fan-out non-crossing (1 source → 2 stacked targets) --------------------
// The case the user pinned: one box fans out to two others. When the two targets
// are stacked (one above the other) on the same side, the two edges must NOT cross
// — the upper-target line and the lower-target line have to nest, not interleave.
// These are SYNTHETIC plain boxes (no composites), so the offline geometry equals
// the browser render exactly — a reliable fast guard for the fan-out nesting rule.

// --- fan-out nesting (1 source → several targets on one side) ---------------
// A same-source fan's lines must NEST: none may properly cross another, anywhere along its
// length (not just away from the source). The check below is the one inspect-arch's EDGE CROSS
// makes, on the SAMPLED drawn curves (`flattenPath`) — with NO proximity exemption. The old
// exemption forgave any crossing within 60px of the shared node, which is exactly where a
// mis-nested fan crosses (lakehouse → genie + downstream consumers, reported on staging).
// These are plain boxes, so the offline geometry equals the browser render.

/** Proper (X) crossings between every pair of drawn curves. A shared endpoint is not a crossing. */
function properCrossings(
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[],
  l: Lookup,
): string[] {
  const ccw = (P: { x: number; y: number }, Q: { x: number; y: number }, R: { x: number; y: number }) =>
    (R.y - P.y) * (Q.x - P.x) - (Q.y - P.y) * (R.x - P.x);
  const fan = computeFanLayout(edges as never, l as never);
  const polys = new Map(edges.map((e) => [
    e.id,
    flattenPath(drawnPath(fan.get(e.id)!, rectOfNode(l, e.source), rectOfNode(l, e.target)).path),
  ]));
  const out: string[] = [];
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const A = polys.get(edges[i].id)!, B = polys.get(edges[j].id)!;
    let hit = false;
    for (let x = 1; x < A.length && !hit; x++) for (let y = 1; y < B.length; y++) {
      const p = A[x - 1], q = A[x], r = B[y - 1], s = B[y];
      if (ccw(p, r, s) * ccw(q, r, s) < 0 && ccw(p, q, r) * ccw(p, q, s) < 0) { hit = true; break; }
    }
    if (hit) out.push(`${edges[i].id} ✕ ${edges[j].id}`);
  }
  return out;
}

/** One source box `s` fanning to `targets` (id → box) out of its `side`, every edge on its own.
 *  The side is AUTHORED (`@r` → `@l`, as a diagram writes it): geometry alone would send a wide,
 *  flat tile's far targets out of its bottom, which is a different fan. */
function fanScene(
  s: [number, number, number, number],
  targets: Record<string, [number, number, number, number]>,
  side: "r" | "l" | "t" | "b" = "r",
) {
  const opposite = { r: "l", l: "r", t: "b", b: "t" } as const;
  const l = lookup({ src: s, ...targets });
  const edges = Object.keys(targets).map((id) => ({
    id: `e-${id}`, source: "src", target: id, sourceHandle: side, targetHandle: opposite[side],
  }));
  return { l, edges };
}

const SRC: [number, number, number, number] = [0, 200, 230, 54]; // a lakehouse-sized tile, mid-height
const TILE = (x: number, y: number): [number, number, number, number] => [x, y, 300, 56];

const nestingCases: { name: string; s: [number, number, number, number]; t: Record<string, [number, number, number, number]>; side?: "r" | "l" | "t" | "b" }[] = [
  // Right side. All below, all above, mixed, and a same-row sibling (the staging report).
  { name: "right: three below", s: SRC, t: { a: TILE(560, 330), b: TILE(560, 430), c: TILE(560, 530) } },
  { name: "right: three above", s: SRC, t: { a: TILE(560, -150), b: TILE(560, -50), c: TILE(560, 50) } },
  { name: "right: above + below", s: SRC, t: { a: TILE(560, -120), b: TILE(560, 330), c: TILE(560, 450) } },
  { name: "right: same row + two below", s: SRC, t: { g: TILE(560, 200), a: TILE(560, 330), b: TILE(560, 430) } },
  { name: "right: same row + three below", s: SRC, t: { g: TILE(560, 200), a: TILE(560, 310), b: TILE(560, 420), c: TILE(560, 530) } },
  // Left side, mirrored.
  { name: "left: three below", s: [700, 200, 230, 54], t: { a: TILE(100, 330), b: TILE(100, 430), c: TILE(100, 530) }, side: "l" },
  { name: "left: three above", s: [700, 200, 230, 54], t: { a: TILE(100, -150), b: TILE(100, -50), c: TILE(100, 50) }, side: "l" },
  { name: "left: same row + two below", s: [700, 200, 230, 54], t: { g: TILE(100, 200), a: TILE(100, 330), b: TILE(100, 430) }, side: "l" },
  // Bottom side: targets stacked beneath, spread across.
  { name: "bottom: three across", s: [300, 0, 230, 54], t: { a: TILE(0, 330), b: TILE(330, 330), c: TILE(660, 330) }, side: "b" },
  { name: "bottom: two left + one right", s: [300, 0, 230, 54], t: { a: TILE(-100, 330), b: TILE(-300, 430), c: TILE(700, 330) }, side: "b" },
  // Top side, mirrored.
  { name: "top: three across", s: [300, 500, 230, 54], t: { a: TILE(0, -50), b: TILE(330, -50), c: TILE(660, -50) }, side: "t" },
];

test("same-source fans nest — every side, below/above/mixed, with and without a same-row target", () => {
  const failures: string[] = [];
  for (const c of nestingCases) {
    const { l, edges } = fanScene(c.s, c.t, c.side);
    const hits = properCrossings(edges, l);
    if (hits.length) failures.push(`${c.name}: ${hits.join(", ")}`);
  }
  assert.deepEqual(failures, [], `same-source fan lines cross:\n  ${failures.join("\n  ")}`);
});

test("same-source fans nest — seeded sweep of right-side fans (3–4 targets, random heights)", () => {
  // Deterministic LCG so a failure reproduces: targets stacked in one column, random heights.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const failures: string[] = [];
  for (let k = 0; k < 150; k++) {
    const n = 3 + Math.floor(rnd() * 2);
    const x = 500 + Math.floor(rnd() * 200);
    // Rows at least one tile-height + a gap apart: stacked tiles, never overlapping ones.
    const ys: number[] = [];
    while (ys.length < n) {
      const y = Math.round(-260 + rnd() * 720);
      if (ys.every((o) => Math.abs(o - y) >= 90)) ys.push(y);
    }
    const t: Record<string, [number, number, number, number]> = {};
    ys.sort((a, b) => a - b).forEach((y, i) => { t[`t${i}`] = TILE(x, y); });
    const { l, edges } = fanScene(SRC, t);
    const hits = properCrossings(edges, l);
    if (hits.length) failures.push(`case ${k} (ys ${ys.join(",")}): ${hits.join(", ")}`);
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length}/150 sweep cases cross; first ones:`);
});

test("same-source fan nesting: the elbows are ordered, and every track sits in its corridor", () => {
  // The rule itself, not just its outcome: below-group, higher exit → elbow NEARER the target.
  const { l, edges } = fanScene(SRC, { a: TILE(560, 330), b: TILE(560, 430), c: TILE(560, 530) });
  const fan = computeFanLayout(edges as never, l as never);
  const cx = (id: string) => fan.get(`e-${id}`)!.centerX!;
  assert.ok(cx("a") > cx("b") && cx("b") > cx("c"), `higher exit nearer the target: a=${cx("a")} b=${cx("b")} c=${cx("c")}`);
  for (const id of ["a", "b", "c"]) {
    assert.ok(cx(id) > 230 + 19 && cx(id) < 560 - 19, `${id} elbow ${cx(id)} is clear of both stubs`);
  }
});

test("a same-row sibling does not pull a lower-exit fan line onto its track", () => {
  // The lakehouse→Genie case: Genie is level with the source, the three others sit below. The
  // four tracks must stay ordered (no inversion) even though the Genie corridor is short.
  const { l, edges } = fanScene(SRC, { g: TILE(260, 200), a: TILE(560, 330), b: TILE(560, 430), c: TILE(560, 530) });
  const fan = computeFanLayout(edges as never, l as never);
  const cx = (id: string) => fan.get(`e-${id}`)!.centerX!;
  assert.ok(cx("g") > cx("a") && cx("a") > cx("b") && cx("b") > cx("c"),
    `tracks ordered by exit: g=${cx("g")} a=${cx("a")} b=${cx("b")} c=${cx("c")}`);
  assert.deepEqual(properCrossings(edges, l), [], "and nothing crosses");
});

/** Do edges `a` and `b` properly cross (strict: no proximity exemption)? */
function edgesCross(
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[],
  l: Lookup, aId: string, bId: string,
): boolean {
  return properCrossings(edges, l).some((p) => p === `${aId} ✕ ${bId}` || p === `${bId} ✕ ${aId}`);
}

// A source box at the origin, fanning to two targets. We place the two targets in
// each relative arrangement and assert no cross. Box 120×60, well separated.
const S: [number, number, number, number] = [0, 200, 120, 60]; // source, mid-height
const fanCases: { name: string; t1: [number,number,number,number]; t2: [number,number,number,number] }[] = [
  // targets to the RIGHT, stacked (the architecture-complete Lakehouse→Dashboard/Genie case)
  { name: "right: upper + lower",      t1: [400, 80, 120, 60],  t2: [400, 320, 120, 60] },
  { name: "right: both slightly below", t1: [400, 240, 120, 60], t2: [400, 380, 120, 60] },
  { name: "right: both above",          t1: [400, 20, 120, 60],  t2: [400, 120, 120, 60] },
  // the user's exact words: "bottom right and 1 below"
  { name: "bottom-right + directly below", t1: [400, 340, 120, 60], t2: [60, 400, 120, 60] },
  // targets to the LEFT, stacked
  { name: "left: upper + lower",        t1: [-400, 80, 120, 60], t2: [-400, 320, 120, 60] },
  // targets ABOVE, side by side
  { name: "above: left + right",        t1: [-200, -120, 120, 60], t2: [220, -120, 120, 60] },
  // targets BELOW, side by side
  { name: "below: left + right",        t1: [-200, 480, 120, 60], t2: [220, 480, 120, 60] },
  // one right, one below (mixed)
  { name: "mixed: right + below",       t1: [400, 180, 120, 60], t2: [40, 460, 120, 60] },
];

test("fan-out never crosses — 1 source → 2 targets, all relative positions", () => {
  const failures: string[] = [];
  for (const c of fanCases) {
    const l = lookup({ src: S, t1: c.t1, t2: c.t2 });
    const edges = [
      { id: "e1", source: "src", target: "t1" },
      { id: "e2", source: "src", target: "t2" },
    ];
    if (edgesCross(edges, l, "e1", "e2")) failures.push(c.name);
  }
  assert.deepEqual(
    failures, [],
    `fan-out lines cross for: ${failures.join(", ")} — the two edges from one `
    + `source to stacked/side-by-side targets must nest, not interleave`,
  );
});

test("spreadFrac: small fans keep the 0.18 gap, big fans shrink it to fit", () => {
  // Single line centres.
  assert.equal(spreadFrac(0, 1), 0.5);
  // 2 and 3 lines are unchanged from the tuned fixed gap (0.18).
  assert.ok(Math.abs((spreadFrac(1, 2) - spreadFrac(0, 2)) - 0.18) < 1e-9, "N=2 gap 0.18");
  assert.ok(Math.abs((spreadFrac(1, 3) - spreadFrac(0, 3)) - 0.18) < 1e-9, "N=3 gap 0.18");
  // Every fan stays inside the usable band AND strictly increasing (non-crossing order).
  for (const n of [1, 2, 3, 5, 7, 12, 20]) {
    const fr = Array.from({ length: n }, (_, i) => spreadFrac(i, n));
    for (const f of fr) assert.ok(f >= 0.08 - 1e-9 && f <= 0.92 + 1e-9, `N=${n} in band`);
    for (let i = 1; i < n; i++) assert.ok(fr[i] > fr[i - 1], `N=${n} strictly increasing`);
  }
  // The gap SHRINKS as the fan grows (the whole point): 7 tighter than 3, 12 tighter than 7.
  const gap = (n: number) => spreadFrac(1, n) - spreadFrac(0, n);
  assert.ok(gap(7) < gap(3), "N=7 gap < N=3 gap");
  assert.ok(gap(12) < gap(7), "N=12 gap < N=7 gap");
  // A big fan uses the full band edge-to-edge instead of piling on the clamp.
  assert.ok(spreadFrac(0, 7) <= 0.09 && spreadFrac(6, 7) >= 0.91, "N=7 spans the band");
});

test("a label is not stranded on ANOTHER edge's line", () => {
  // e2 runs vertically through x=450 — the elbow where e1's label sits on its
  // horizontal run. e1's label must slide off e2's line (EDGE UNDER LABEL).
  const l = lookup({ a: [0, 0, 200, 56], b: [700, 0, 200, 56], top: [430, -200, 40, 40], bottom: [430, 200, 40, 40] });
  const edges = [
    { id: "e1", source: "a", target: "b", label: "Live state" },
    { id: "e2", source: "top", target: "bottom" },
  ];
  const rect = labelRectOf(edges, l, "e1");
  assert.ok(!(rect.x - 2 <= 450 && rect.x + rect.w + 2 >= 450), "label must not cover x=450, where e2 runs");
});

test("fan routing is independent of edge array order (lane pass included)", () => {
  // Four edges between two columns of nodes, a mix of fan-out and crossing pairs:
  // the lane pass and the fan ordering must give the SAME entries however the edge
  // array is listed (the cache signature and the id-sorted passes both depend on it).
  const l = lookup({ a: [0, 0, 200, 56], c: [0, 200, 200, 56], b: [700, 0, 200, 56], d: [700, 200, 200, 56], m: [350, 90, 120, 40] });
  const edges = [
    { id: "e1", source: "a", target: "d" },
    { id: "e2", source: "c", target: "b" },
    { id: "e3", source: "a", target: "b" },
    { id: "e4", source: "c", target: "d" },
  ];
  const fwd = computeFanLayout(edges as never, l as never);
  const rev = computeFanLayout(edges.slice().reverse() as never, l as never);
  for (const e of edges) {
    assert.deepEqual(rev.get(e.id), fwd.get(e.id), `${e.id} must route the same in either order`);
  }
});

test("pin above/below + fill: a banner sits outside its box and spans its width", () => {
  const file = {
    name: "T", aspect: "16:9", direction: "horizontal",
    columns: ["a", "b"],
    nodes: [
      { id: "x1", type: "genie", col: "a", row: 0 },
      { id: "x2", type: "genie", col: "a", row: 1 },
      { id: "phase", type: "box", wraps: ["x1", "x2"] },
      { id: "banner", type: "shape", shape: "chevron", text: "1 · Phase", size: [120, 64], pin: { at: "above", to: "phase", fill: true, pad: 30 } },
      { id: "foot", type: "text", text: "after", size: [80, 30], pin: { at: "below", to: "phase" } },
    ],
    edges: [],
  };
  const placed = computeLayout(file as never);
  const box = placed.get("phase")!, ban = placed.get("banner")!, foot = placed.get("foot")!;
  assert.equal(ban.w, box.w, "fill: banner width = box width");
  assert.equal(ban.x, box.x, "banner centred on the box");
  assert.equal(Math.round(ban.y + ban.h / 2), Math.round(box.y - box.h / 2 - 30), "banner bottom sits `pad` above the box top");
  assert.equal(foot.w, 80, "no fill: keeps its own width");
  assert.equal(Math.round(foot.y - foot.h / 2), Math.round(box.y + box.h / 2 + 24), "below: default 24px gap under the box");

  const schema = parseArchitecture(tab(file));
  const once = serializeArchitecture(schema, schema.layout);
  const reparsed = parseArchitecture(once);
  const twice = serializeArchitecture(reparsed, reparsed.layout);
  assert.equal(once, twice, "parse→serialize must be byte-stable across two passes");
  // Saved nested (the old file is migrated on parse): the banner is structure inside the
  // phase box, never a pixel position.
  const out = JSON.parse(once.replace(/```json\n|\n```\n?/g, ""));
  const tabOut = Array.isArray(out) ? out[0] : out;
  const b = findDeep(tabOut.nodes, "banner")!;
  assert.ok(b, "the banner survives the migration");
  assert.equal(b.at, undefined, "an unmoved banner is not flattened to pixels");
  assert.equal(b.pin, undefined, "pins become structure");
  assert.ok(findDeep(tabOut.nodes, "phase")?.children, "the phase box holds its members");
});

// --- card / box subtitle / edge colour ---------------------------------------
// A `card` measures its own height from the wrapped text; the layout, the
// ReactFlow box and the render all call the same cardLayout. These pin that the
// three agree, that new fields round-trip byte-stably, and that stacking reserves
// the measured height.

const cardFile = () => ({
  name: "cards", aspect: "16:9" as const, direction: "horizontal" as const,
  columns: ["a", "b"],
  nodes: [
    {
      id: "c1", type: "card", col: "a", row: 1,
      icon: "data", title: "Unity Catalog governed lakehouse across every business domain",
      summary: "One governed copy of the data",
      desc: "Tables, lineage and access policies are managed centrally so every downstream consumer reads the same definitions.",
      chips: [{ key: "CK", value: "tenant_gid", color: "#E8731A" }, { value: "plain chip" }],
      tags: ["MERGE", { text: "APPEND", color: "#2563EB" }],
      badge: "PROPOSED", badgeColor: "#1F7A6E", accent: "#00A972", titleColor: "#0F172A",
    },
    { id: "c2", type: "card", col: "a", row: 2, title: "Second card", summary: "Stacks under the first", desc: "Short." },
    { id: "b1", type: "card", col: "b", row: 1, title: "Plain" },
    { id: "grp", type: "box", wraps: ["c1", "c2"], title: "Platform", subtitle: "Owned by the data platform team across regions", borderStyle: "dashed", badge: "NEW" },
  ],
  edges: [
    { id: "e1", from: "c1", to: "c2", color: "#2563EB", dashed: true },
    { id: "e2", from: "c2", to: "b1" },
  ],
});

test("wrapLineCount wraps greedily and hard-breaks long words", () => {
  assert.equal(wrapLineCount("", 200, 12), 0, "empty text is zero lines");
  assert.equal(wrapLineCount("one two three", 10_000, 12), 1, "fits on one line when wide");
  assert.ok(wrapLineCount("one two three four five six", 80, 12) >= 3, "narrow width wraps to several lines");
  assert.ok(wrapLineCount("x".repeat(200), 100, 12) >= 4, "a word longer than a line breaks by character");
  assert.equal(wrapLineCount("a\nb", 10_000, 12), 2, "newlines start a new paragraph");
});

test("cardLayout: height grows with text, title wraps, size.h is a floor", () => {
  const short = cardLayout({ title: "Hi" });
  const long = cardLayout({ title: "A very long title that must wrap onto several lines inside the header band", body: "<p>s</p><p>" + "word ".repeat(60) + "</p>" });
  assert.equal(short.w, CARD_WIDTH, "default width");
  assert.ok(long.h > short.h + 60, "more text reserves more height");
  assert.ok(long.titleH > short.titleH, "a long title wraps to more lines");
  assert.equal(cardLayout({}).h, 56, "an empty card keeps a usable minimum");
  assert.equal(cardLayout({ title: "Hi" }, { h: 400 }).h, 400, "size.h is a floor");
  assert.ok(cardLayout({ body: "<p>" + "word ".repeat(60) + "</p>" }, { h: 40 }).h > 40, "size.h never clips the content");
  const narrow = cardLayout({ title: "Same words here for both cards" }, { w: 160 });
  assert.ok(narrow.titleH >= short.titleH, "a narrower card wraps at least as much");
});

test("naturalSize + computeLayout + ReactFlow box agree on a card's footprint", () => {
  const file = cardFile();
  const c1 = file.nodes[0] as Record<string, unknown>;
  const measured = cardLayout(c1);
  assert.deepEqual(naturalSize("card", undefined, undefined, c1 as never), { w: measured.w, h: measured.h }, "naturalSize measures from content");
  assert.deepEqual(naturalSize("card"), { w: CARD_WIDTH, h: 120 }, "no content → the fallback size");

  const placed = computeLayout(file as never).get("c1")!;
  assert.equal(placed.w, measured.w, "computeLayout width = cardLayout width");
  assert.equal(placed.h, measured.h, "computeLayout height = cardLayout height");
  // The render (annotations.tsx) and flow-mapping both call cardLayout too; they
  // can't be imported here (Vite-only import.meta.glob in file-icons), so pin the
  // shared fallback size at source level instead.
  const annoSrc = readFileSync(new URL("../src/demo_prompt_generator/ui/components/project/platform-diagram/annotations.tsx", import.meta.url), "utf8");
  assert.ok(annoSrc.includes("card: { w: CARD_WIDTH, h: 120 }"), "annotations.tsx fallback card size mirrors the lib");
});

test("stacked cards reserve each other's measured height (no overlap)", () => {
  const placed = computeLayout(cardFile() as never);
  const a = placed.get("c1")!, b = placed.get("c2")!;
  assert.ok(b.y - a.y >= a.h / 2 + b.h / 2 - 1, `c2 sits below c1's measured bottom (dy=${b.y - a.y}, need ≥ ${a.h / 2 + b.h / 2})`);
});

test("a box with a subtitle grows upward so its members clear the title strip", () => {
  const placed = computeLayout(cardFile() as never);
  const grp = placed.get("grp")!, m = placed.get("c1")!;
  const top = grp.y - grp.h / 2, memberTop = m.y - m.h / 2;
  const reserved = memberTop - top;
  const sub = "Owned by the data platform team across regions";
  assert.ok(reserved >= 34 + boxSubtitleH(sub, grp.w) - 1, `the subtitle is reserved above the members (got ${reserved})`);
});

test("a box's subtitle is reserved at the width the box is DRAWN at (layout and render agree)", () => {
  // The renderer wraps the subtitle at the box's own width. A narrow box wraps it to
  // more lines than the old 200px default, so the reserved band must follow the real
  // width. Both files differ ONLY by the subtitle, so the member offset delta is exactly
  // the subtitle's reserved height at the box's width.
  const sub = "Owned by the platform team across every region and business unit";
  const file = (subtitle?: string) => ({
    name: "narrow", columns: ["a"],
    nodes: [
      { id: "m", type: "card", col: "a", row: 0, size: [120, 60], title: "Member" },
      { id: "grp", type: "box", wraps: ["m"], pad: 0, title: "Box", ...(subtitle ? { subtitle } : {}) },
    ],
    edges: [],
  });
  const offset = (boxes: ReturnType<typeof computeLayout>) => {
    const g = boxes.get("grp")!, m = boxes.get("m")!;
    return { reserved: m.y - m.h / 2 - (g.y - g.h / 2), w: g.w };
  };
  const withSub = offset(computeLayout(file(sub) as never));
  const without = offset(computeLayout(file() as never));
  assert.equal(withSub.w, without.w, "the subtitle does not change the box width");
  assert.notEqual(boxSubtitleH(sub, withSub.w), boxSubtitleH(sub, 200), "the case discriminates: a narrow box wraps differently from 200px");
  assert.equal(withSub.reserved - without.reserved, boxSubtitleH(sub, withSub.w), `the reserved band is the subtitle measured at the box width (${withSub.w}px)`);
});

test("card, box subtitle/badge and edge colour round-trip byte-stably", () => {
  const schema = parseArchitecture(tab(cardFile()));
  const once = serializeArchitecture(schema, schema.layout);
  const reparsed = parseArchitecture(once);
  const twice = serializeArchitecture(reparsed, reparsed.layout);
  assert.equal(once, twice, "parse→serialize must be byte-stable across two passes");
  const out = JSON.parse(once.replace(/```json\n|\n```\n?/g, "")) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] | { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  const file = Array.isArray(out) ? out[0] : out;
  const c1 = findDeep(file.nodes, "c1")!;
  // The legacy summary/desc/chips/tags fold into ONE body on save (written as `body` only).
  const legacy = cardFile().nodes[0] as never;
  assert.equal(c1.body, legacyCardBody(legacy), "legacy fields fold into the body verbatim");
  assert.equal(c1.chips, undefined, "chips are no longer written");
  assert.equal(c1.tags, undefined, "tags are no longer written");
  assert.equal(c1.summary, undefined, "summary is no longer written");
  for (const k of ["badge", "badgeColor", "accent", "titleColor", "icon", "title"]) {
    assert.equal(c1[k], (cardFile().nodes[0] as Record<string, unknown>)[k], `${k} round-trips`);
  }
  const grp = findDeep(file.nodes, "grp")!;
  assert.equal(grp.subtitle, "Owned by the data platform team across regions", "box subtitle round-trips");
  assert.equal(grp.badge, "NEW", "box badge round-trips");
  const e1 = file.edges.find((e) => e.id === "e1")!;
  assert.equal(e1.color, "#2563EB", "edge colour round-trips");
  assert.equal(e1.dashed, true, "a dashed coloured edge keeps both");
  assert.equal(schema.layout.edges.find((e) => e.id === "e1")?.color, "#2563EB", "the colour reaches the canvas edge");
});

test("a card is a known node type and validates clean", () => {
  const issues = validateArchitecture(tab(cardFile()));
  assert.deepEqual(issues.filter((i) => i.field === "type"), [], "card is not an unknown type");
});


test("deprecated KA/MAS/databricks-agent still parse and validate (never 'Unknown component')", () => {
  // Existing diagrams use these; they must keep rendering and must not fail the
  // gated content check. The palette hides them, the generated skill omits them.
  const file = {
    name: "legacy", aspect: "16:9" as const, direction: "horizontal" as const,
    columns: ["a", "b"],
    nodes: [
      { id: "ka", type: "knowledge-assistant", col: "a" },
      { id: "sup", type: "supervisor-agent", col: "a" },
      { id: "ab", type: "agent-bricks", col: "b" },
    ],
    edges: [{ id: "e1", from: "ka", to: "sup" }, { id: "e2", from: "sup", to: "ab" }],
  };
  const issues = validateArchitecture(tab(file));
  assert.deepEqual(issues.filter((i) => i.field === "type"), [], "deprecated types are known types");
});

// --- batch 2: title-only cards, card fill/ink, glyphs, label size, box header --

test("a title-only card is centred (no header band) and a titled card with a body is not", () => {
  const label = cardLayout({ title: "Workspace assets", icon: "lucide:folder" });
  assert.equal(label.centered, true, "title alone → centred label");
  assert.equal(label.headerH, 0, "no header band on a centred label");
  const card = cardLayout({ title: "Workspace assets", body: "<p>s</p>" });
  assert.equal(card.centered, false, "a body makes it a normal card");
  assert.ok(label.h < card.h, "a centred label is shorter than a card with a body");
  const sized = cardLayout({ title: "Workspace assets" }, { h: 200 });
  assert.equal(sized.h, 200, "size.h still wins as a floor");
});

test("card fill and textColor round-trip, and titleColor still wins for the title", () => {
  const file = {
    name: "t", aspect: "16:9" as const,
    nodes: [{ id: "c", type: "card", at: [0, 0], title: "Tag", summary: "s", desc: "d", fill: "#E8731A", textColor: "#FFFFFF" }],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  assert.equal(schema.layout.nodes["c"].annotation?.fill, "#E8731A");
  assert.equal(schema.layout.nodes["c"].annotation?.textColor, "#FFFFFF");
  const out = serializeArchitecture(schema, schema.layout);
  const c = JSON.parse(out.replace(/```json\n|\n```\n?/g, "")).nodes.find((n: { id: string }) => n.id === "c");
  assert.equal(c.fill, "#E8731A", "fill survives serialize");
  assert.equal(c.textColor, "#FFFFFF", "textColor survives serialize");
  assert.equal(serializeArchitecture(parseArchitecture(out), parseArchitecture(out).layout), out, "stable across a second pass");
});

test("box style.headerFill round-trips through the style object", () => {
  const file = {
    name: "t", aspect: "16:9" as const,
    nodes: [{ id: "g", type: "box", at: [0, 0], size: [300, 200], title: "Lakehouse", subtitle: "Owned by data", style: { headerFill: "#DBEAFE" } }],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  assert.equal(schema.layout.nodes["g"].headerFill, "#DBEAFE", "parsed onto the node position");
  const out = serializeArchitecture(schema, schema.layout);
  const g = JSON.parse(out.replace(/```json\n|\n```\n?/g, "")).nodes.find((n: { id: string }) => n.id === "g");
  assert.equal(g.style.headerFill, "#DBEAFE", "re-emitted under style");
});

test("options.edgeLabelSize round-trips, is clamped, and is absent by default", () => {
  const base = { name: "t", aspect: "16:9" as const, nodes: [{ id: "a", type: "genie", at: [0, 0] }], edges: [] };
  const sized = parseArchitecture(tab({ ...base, options: { edgeLabelSize: 15 } }));
  assert.equal(sized.edgeLabelSize, 15, "the tab size is read");
  const out = serializeArchitecture(sized, sized.layout);
  assert.equal(JSON.parse(out.replace(/```json\n|\n```\n?/g, "")).options.edgeLabelSize, 15, "and written back");
  assert.equal(parseArchitecture(tab({ ...base, options: { edgeLabelSize: 99 } })).edgeLabelSize, EDGE_LABEL_SIZE_MAX, "clamped high");
  assert.equal(parseArchitecture(tab({ ...base, options: { edgeLabelSize: 1 } })).edgeLabelSize, EDGE_LABEL_SIZE_MIN, "clamped low");
  const plain = parseArchitecture(tab(base));
  assert.equal(plain.edgeLabelSize, undefined, "unset by default");
  assert.doesNotMatch(serializeArchitecture(plain, plain.layout), /edgeLabelSize/, "and not written when unset");
});

test("the edge-label chip scales with its font in the metrics every consumer shares", () => {
  const at11 = measureLabel("nightly CDC");
  const at16 = measureLabel("nightly CDC", 16);
  assert.ok(at16.w > at11.w && at16.h > at11.h, "a bigger font is a bigger chip");
  assert.deepEqual(measureLabel("nightly CDC", 11), at11, "11px is the reference, unchanged");
  assert.ok(Math.abs(lineCenterY(0, at16.h, 16)) < 1e-9, "a single line is centred on the chip");
  // A longer label wraps at the SAME character count, so it doesn't balloon sideways.
  const longLabel = "served to dashboards and Genie spaces across every business unit";
  assert.ok(wrapLabel(longLabel, 16).length <= MAX_LINES, "the clamp still holds at a bigger size");
  assert.ok(chipSize(wrapLabel(longLabel, 16), 16).w <= chipSize(wrapLabel(longLabel, 11), 11).w * 16 / 11 + 2, "wrap width scales with the font");
});

test("lucide glyph keys resolve only for the curated names", () => {
  assert.equal(lucideGlyphName("lucide:database"), "database");
  assert.equal(lucideGlyphName("lucide:not-a-glyph"), null, "an unknown name is not a glyph");
  assert.equal(lucideGlyphName("file:vendor/kafka"), null, "other key families are untouched");
  assert.equal(new Set(LUCIDE_GLYPH_NAMES).size, LUCIDE_GLYPH_NAMES.length, "no duplicate names");
  assert.equal(LUCIDE_GLYPH_NAMES.length, 50, "the curated set is the 50 named glyphs");
});

// --- box title placement, min size, card style aliases, soft word breaks ----

/** A wrapping box over two cards in one lane. `box` supplies the box's own fields. */
const stageFile = (box: Record<string, unknown>) => ({
  columns: ["a"],
  nodes: [
    { id: "c1", type: "card", col: "a", row: 1, title: "One", size: [200, 40] },
    { id: "c2", type: "card", col: "a", row: 2, title: "Two", size: [200, 40] },
    { id: "box", type: "box", wraps: ["c1", "c2"], ...box },
  ],
});

test("an inside-top title reserves its band: members start below it, border titles do not", () => {
  const top = computeLayout(stageFile({ titlePos: "top", title: "Stage", fontSize: 24 } as never));
  const box = top.get("box")!;
  const c1 = top.get("c1")!;
  const band = insideTitleMetrics({ title: "Stage", fontSize: 24 }, box.w).band;
  assert.ok(band > 40, "a 24px title reserves a real band");
  assert.ok(c1.y - c1.h / 2 - (box.y - box.h / 2) >= band, "the first member clears the title band");
  const border = computeLayout(stageFile({ title: "Stage", fontSize: 24 } as never)).get("box")!;
  const borderC1 = computeLayout(stageFile({ title: "Stage", fontSize: 24 } as never)).get("c1")!;
  assert.ok(borderC1.y - borderC1.h / 2 - (border.y - border.h / 2) < band, "a border title keeps the old, smaller reservation");
});

test("an inside-bottom title grows the box DOWN past its members", () => {
  const layout = computeLayout(stageFile({ titlePos: "bottom-left", title: "Group", fontSize: 18 } as never));
  const box = layout.get("box")!;
  const c2 = layout.get("c2")!;
  const band = insideTitleMetrics({ title: "Group", fontSize: 18 }, box.w).band;
  assert.ok((box.y + box.h / 2) - (c2.y + c2.h / 2) >= band, "the bottom band sits below the last member");
  assert.ok(isInsideTitlePos("bottom-left") && isInsideTitlePos("top") && !isInsideTitlePos("border") && !isInsideTitlePos(undefined), "only the four inside placements count as inside");
});

test("a wrapping box's size is a minimum: wider/taller boxes stay put, top-aligned and centred", () => {
  const natural = computeLayout(stageFile({ titlePos: "top", title: "Stage", fontSize: 24 } as never)).get("box")!;
  const sized = computeLayout(stageFile({ titlePos: "top", title: "Stage", fontSize: 24, size: [400, 300] } as never));
  const box = sized.get("box")!;
  const c1 = sized.get("c1")!;
  assert.equal(box.w, 400, "the width is the authored minimum");
  assert.equal(box.h, 300, "the height is the authored minimum");
  assert.equal(box.x, c1.x, "members stay centred horizontally");
  assert.equal(box.y - box.h / 2, natural.y - natural.h / 2, "the box is top-aligned exactly where the natural box starts");
  // Members larger than the minimum still grow the box (a minimum, not a clamp).
  const big = computeLayout(stageFile({ size: [120, 40] } as never)).get("box")!;
  assert.ok(big.w >= 200 && big.h > 40, "a too-small size never shrinks the members' box");
});

test("a wrapping box is at least as wide as its border title", () => {
  // One narrow logo under a long title: the box used to size to the logo and ellipsize the title.
  const file = {
    name: "t", theme: "technical",
    nodes: [
      { id: "db", type: "logo", icon: "lucide:database", text: "DB", caption: "bottom", at: [200, 200] },
      { id: "box", type: "box", title: "On-premises data centre", titleIcon: "lucide:building-2", wraps: ["db"] },
    ],
  } as never;
  const box = computeLayout(file).get("box")!;
  const db = computeLayout(file).get("db")!;
  const need = boxBorderTitleW({ title: "On-premises data centre", titleIcon: "lucide:building-2" }, "technical");
  assert.ok(box.w >= need, `box ${box.w}px fits its title (${need}px)`);
  assert.equal(box.x, db.x, "and stays centred on its member");
  // A title shorter than the members changes nothing.
  const wide = computeLayout({ name: "t", theme: "technical", nodes: [
    { id: "c", type: "card", title: "A very wide card with a long title", at: [200, 200], size: [400, 60] },
    { id: "box", type: "box", title: "X", wraps: ["c"] },
  ] } as never).get("box")!;
  assert.ok(wide.w < 400 + 2 * 40 + 1, "a short title never widens the box past its members + pad");
});

test("titlePos and a box size round-trip through parse and serialize", () => {
  const content = tab({
    name: "t",
    columns: ["a"],
    nodes: [
      { id: "c1", type: "card", col: "a", row: 1, title: "One", size: [200, 40] },
      { id: "box", type: "box", title: "Stage", titlePos: "top", fontSize: 24, wraps: ["c1"], size: [400, 300] },
    ],
  });
  const schema = parseArchitecture(content);
  assert.equal(schema.layout.nodes.box.annotation?.titlePos, "top", "the placement is read");
  const out = JSON.parse(serializeArchitecture(schema, schema.layout).replace(/```json\n|\n```\n?/g, ""));
  const box = findDeep(out.nodes, "box")!;
  assert.equal(box.titlePos, "top", "and written back");
  assert.deepEqual(box.size, [400, 300], "the minimum size is written back as size, not as a frozen box");
  assert.deepEqual((box.children as { id: string }[]).map((c) => c.id), ["c1"], "the box keeps its member as a child");
  const again = parseArchitecture(serializeArchitecture(schema, schema.layout));
  assert.equal(again.layout.nodes.box.w, schema.layout.nodes.box.w, "a second parse lands on the same width");
  // An unset / default title is not written.
  const plain = parseArchitecture(tab({ name: "t", nodes: [{ id: "b", type: "box", title: "X" }] }));
  assert.doesNotMatch(serializeArchitecture(plain, plain.layout), /titlePos/, "no titlePos unless set");
  // An unknown placement is a content fault, not a silent border title.
  const bad = validateArchitecture(tab({ name: "t", nodes: [{ id: "b", type: "box", title: "X", titlePos: "middle" }] }));
  assert.ok(bad.some((i) => i.field === "titlePos"), "validate reports an unknown titlePos");
});

test("card style aliases: style.fill / borderColor / borderStyle / border / radius, top-level fill wins", () => {
  const schema = parseArchitecture(tab({
    name: "t",
    nodes: [
      { id: "k", type: "card", title: "K", style: { fill: "#E2E8F0", borderColor: "#334155", borderStyle: "dashed", border: 2, radius: 14 } },
      { id: "j", type: "card", title: "J", fill: "#111111", style: { fill: "#222222" } },
    ],
  }));
  const k = schema.layout.nodes.k;
  assert.equal(k.annotation?.fill, "#E2E8F0", "style.fill stands in for fill");
  assert.equal(k.annotation?.accent, "#334155", "style.borderColor stands in for accent");
  assert.equal(k.borderStyle, "dashed", "style.borderStyle is honoured");
  assert.equal(k.borderWidth, 2, "style.border is the width");
  assert.equal(k.borderRadius, 14, "style.radius is the corner radius");
  assert.equal(schema.layout.nodes.j.annotation?.fill, "#111111", "a top-level fill wins over style.fill");
});

test("soft word breaks: separators and camelCase are break points, short words are unchanged", () => {
  assert.deepEqual(softBreakPieces("reporting.gold_v3_staging"), ["reporting.", "gold_", "v3_", "staging"]);
  assert.deepEqual(softBreakPieces("eventDate"), ["event", "Date"], "a lowercase→UPPERCASE boundary is a break point");
  assert.deepEqual(softBreakPieces("plain"), ["plain"], "a word with no break point is one piece");
  const long = "reporting.gold_v3_staging_daily_partitioned";
  assert.equal(softBreakPieces(long).join(""), long, "the pieces rejoin to the original word");
  assert.equal(wrapLineCount("abc_def", 300, 14, true, true), wrapLineCount("abc_def", 300, 14, true), "a word that fits is measured as before");
  assert.ok(
    wrapLineCount(long, 200, 14, true, true) <= wrapLineCount(long, 200, 14, true),
    "soft mode never reports MORE lines than break-anywhere (it wraps at the separators instead)",
  );
});


test("title-only card auto-fits: grows with the box, never wider than it, clamped to 13–28px", () => {
  // Monotone in box size: a larger box never gives a smaller title.
  let prev = 0;
  for (const [w, h] of [[120, 40], [160, 56], [200, 56], [276, 56], [276, 80], [280, 110], [420, 110], [600, 200]]) {
    const l = cardLayout({ title: "Inception" }, { w, h });
    assert.ok(l.titleFont >= prev, `monotone: ${w}x${h} gave ${l.titleFont} after ${prev}`);
    prev = l.titleFont;
    assert.ok(l.titleFont >= CARD_LABEL_MIN_FONT && l.titleFont <= CARD_LABEL_MAX_FONT, "clamped to [13, 28]");
    assert.ok(l.titleH <= l.h, "the title block sits inside the card");
  }
  // Clamps: a tiny box floors at 13px, a huge one caps at 28px.
  assert.equal(cardLabelFont("Inception", 40, 10), CARD_LABEL_MIN_FONT, "no room at all → the floor");
  assert.equal(cardLabelFont("Inception", 254, 500), CARD_LABEL_MAX_FONT, "plenty of room → the cap");
  // Never wider than the box: a long title wraps inside the content width.
  const long = cardLabelFont("Reporting gold staging daily partitioned tables", 200, 60);
  assert.ok(wrapLineCount("Reporting gold staging daily partitioned tables", 200, long, true, true) <= 2, "at most 2 lines");
  // A 280×110 "Inception" box fills like a slide label: the cap, not the floor.
  const incep = cardLayout({ title: "Inception" }, { w: 280, h: 110 });
  assert.equal(incep.titleFont, CARD_LABEL_MAX_FONT, "Inception in 280×110 reaches the 28px cap");
  assert.equal(incep.h, 110, "the box keeps its drawn height (no content growth)");
  // An explicit fontSize overrides the fit.
  assert.equal(cardLayout({ title: "Inception", fontSize: 15 }, { w: 280, h: 110 }).titleFont, 15);
  // Layout is stable: a natural (no h) title-only card is the 56px default box.
  assert.equal(cardLayout({ title: "Agent parameters" }).h, 56);
});

test("inside box title defaults scale with the box width, clamped; an explicit fontSize wins", () => {
  assert.equal(insideTitleFont(24, 342), 24, "explicit fontSize wins");
  assert.equal(insideTitleFont(undefined, 100), BOX_TITLE_MIN_FONT, "narrow box → floor");
  assert.equal(insideTitleFont(undefined, 2000), BOX_TITLE_MAX_FONT, "wide box → cap");
  let prev = 0;
  for (let w = 120; w <= 480; w += 20) {
    const f = insideTitleFont(undefined, w);
    assert.ok(f >= prev, "monotone in width");
    prev = f;
  }
  assert.ok(insideTitleMetrics({ title: "Gather requirements" }, 342).font > 15, "a default inside title is larger than the old 15px");
});

test("a captioned logo's pictogram slot leaves room for its caption", () => {
  const box = { w: 120, h: 120 };
  const sized = logoIconSlot(box, { text: "Dev", caption: "bottom", fontSize: 15 });
  assert.ok(sized < 120 - 8, "the icon gives up the caption's height");
  assert.equal(logoIconSlot({ w: 80, h: 80 }, {}), 72, "an uncaptioned logo fills the box minus its pad");
  assert.equal(logoIconSlot({ w: 80, h: 80 }, { text: "Dev", caption: "right", fontSize: 15 }), 72, "a side caption keeps the full height");
});

test("title-only cards in one size class share the smallest fit font; singletons, other sizes and explicit fonts are left alone", () => {
  const nodes = [
    { id: "a", type: "card", title: "Feature Engineering", size: [200, 56] },
    { id: "b", type: "card", title: "Agent Bricks", size: [200, 56] },
    { id: "c", type: "card", title: "Ok", size: [300, 90] },
    { id: "d", type: "card", title: "Pinned", fontSize: 20, size: [200, 56] },
  ];
  const own = (n: { title: string; size: number[] }) => cardLayout({ title: n.title } as never, { w: n.size[0], h: n.size[1] }).titleFont;
  const f = cardGroupFonts(nodes as never);
  const minFont = Math.min(own(nodes[0]), own(nodes[1]));
  assert.equal(f.get("a"), minFont, "the longer title sets the shared font");
  assert.equal(f.get("b"), minFont, "the shorter sibling takes the same font");
  assert.ok(own(nodes[1]) >= minFont, "the sibling would otherwise have been larger");
  assert.equal(f.has("c"), false, "a card whose height is outside the tolerance is not grouped");
  const wide = cardGroupFonts([{ id: "w", type: "card", title: "Feature Engineering", size: [400, 56] }, { id: "x", type: "card", title: "Ok", size: [120, 58] }] as never);
  assert.equal(wide.get("w"), wide.get("x"), "same height, different width: one font");
  assert.equal(f.has("d"), false, "an explicit fontSize opts out");
  // No growth: the shared font still fits the box height the card was given.
  const shared = cardLayout({ title: "Agent Bricks", fontSize: minFont } as never, { w: 200, h: 56 });
  assert.equal(shared.h, 56, "the box keeps its height at the shared font");
  assert.equal(withCardFont({ title: "Agent Bricks" } as never, minFont).fontSize, minFont);
  assert.equal(withCardFont({ title: "x", fontSize: 12 } as never, minFont).fontSize, 12, "an explicit fontSize still wins");
});

test("a user-sized logo's caption grows with its icon slot; auto-sized, explicit and 60px logos keep their caption", () => {
  const cap = { text: "Dev", caption: "bottom" as const };
  assert.equal(logoCaptionFont({ w: 60, h: 60 }, cap, { sized: false }), 15, "auto-sized keeps the default");
  assert.equal(logoCaptionFont({ w: 60, h: 60 }, cap, { sized: true }), 15, "a 60px sized logo stays at the default");
  const big = logoCaptionFont({ w: 120, h: 120 }, cap, { sized: true });
  assert.ok(big > 15 && big <= LOGO_CAPTION_MAX_FONT, `a 120px slot grows the caption (got ${big})`);
  assert.equal(logoCaptionFont({ w: 400, h: 400 }, cap, { sized: true }), LOGO_CAPTION_MAX_FONT, "a huge slot caps at 24px");
  assert.equal(logoCaptionFont({ w: 120, h: 120 }, { ...cap, fontSize: 11 }, { sized: true }), 11, "an explicit fontSize wins");
  assert.equal(logoCaptionFont({ w: 120, h: 120 }, cap, { sized: true, dflt: 18 }) >= 18, true, "slide default is a floor");
  let prev = 0;
  for (let s = 60; s <= 240; s += 10) {
    const f = logoCaptionFont({ w: s, h: s }, cap, { sized: true });
    assert.ok(f >= prev, `monotone at ${s}px`);
    prev = f;
  }
  // The anchor icon square is the same slot the render draws for a sized logo.
  const rect = logoIconRect({ x: 0, y: 0, w: 120, h: 120 }, cap, { sized: true });
  assert.equal(rect.h, logoIconSlot({ w: 120, h: 120 }, cap, { sized: true }), "anchor square == drawn slot");
  // Auto-sized anchors keep the natural 60px cap (no change to existing diagrams).
  assert.equal(logoIconRect({ x: 0, y: 0, w: 120, h: 120 }, cap).h, 60);
});

test("a same-size title-only card group reserves the same footprint in the layout as before", () => {
  const file = {
    columns: [{ id: "c" }],
    nodes: [
      { id: "p", type: "card", title: "Feature Engineering", col: "c", row: 1, size: [200, 56] },
      { id: "q", type: "card", title: "Agent Bricks", col: "c", row: 2, size: [200, 56] },
    ],
    edges: [],
  } as never;
  const boxes = computeLayout(file);
  assert.equal(boxes.get("p")!.h, 56);
  assert.equal(boxes.get("q")!.h, 56);
  assert.equal(boxes.get("p")!.w, 200);
});

// --- Card HTML body: the sanitizer is the only path to the DOM ----------------------


test("card body sanitizer neutralises every hostile payload", () => {
  const hostile = [
    "<script>alert(1)</script>ok",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">click</a>',
    "<svg onload=alert(1)><circle/></svg>",
    "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
    "<div onclick=\"alert(1)\">x</div>",
    '<span style="background:url(http://evil.example/x)">x</span>',
    '<span style="background:&#117;rl(http://evil.example/x)">x</span>',
    '<p style="color:red;expression(alert(1))">x</p>',
    '<p style="position:fixed;top:0;left:0;color:red">x</p>',
    '<p style="color:red!important">x</p>',
    "<scr<script>ipt>alert(1)</script>",
    "<<script>script>alert(1)</script>",
    "<script>alert(1)",
    "<!-- <script>alert(1)</script> --><b>x</b>",
    "<style>body{display:none}</style>x",
    "<object data=\"javascript:alert(1)\"></object>",
    "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
    "a < b and <b onmouseover=alert(1)>bold</b>",
    "<form action=\"javascript:alert(1)\"><input name=x></form>",
  ];
  for (const h of hostile) {
    const out = sanitizeCardBody(h).toLowerCase();
    for (const bad of ["<script", "<svg", "<img", "<iframe", "<object", "<math", "<form", "<input", "onerror", "onclick", "onload", "onmouseover", "javascript:", "url(", "expression", "position", "srcdoc", "href=", "!important", "<style", "<!--", "&#"]) {
      assert.equal(out.includes(bad), false, `"${bad}" survived: ${h} -> ${out}`);
    }
  }
  // Harmless formatting survives, the script's text does not run (its body is dropped).
  assert.equal(sanitizeCardBody("<b>bold</b> and <i>ital</i>"), "<b>bold</b> and <i>ital</i>");
  assert.equal(sanitizeCardBody("<script>alert(1)</script>ok"), "ok");
  assert.equal(sanitizeCardBody('<a href="x">link</a>'), "link", "unknown tags drop, their text stays");
  assert.equal(sanitizeCardBody("a < b"), "a &lt; b", "a bare < is escaped");
  assert.equal(sanitizeCardBody("<br/>x<hr>"), "<br>x<hr>");
});

test("card body keeps only allow-listed style properties with plain values", () => {
  assert.equal(sanitizeCardStyle("color:#E8731A; font-weight:700"), "color:#E8731A;font-weight:700");
  assert.equal(sanitizeCardStyle("color:rgb(10,20,30);text-align:center"), "color:rgb(10,20,30);text-align:center");
  assert.equal(sanitizeCardStyle("color:color-mix(in srgb, red, blue)"), "", "only rgb/rgba/hsl/hsla functions");
  assert.equal(sanitizeCardStyle("display:grid"), "display:grid", "display: block/inline/flex/grid");
  assert.equal(sanitizeCardStyle("display:table"), "", "display: no table/contents/none-escapes");
  assert.equal(sanitizeCardStyle("width:calc(100% - 4px)"), "", "calc is not allowed");
  const out = sanitizeCardBody('<div style="color:#111;position:absolute;background:red">x</div>');
  assert.equal(out, '<div style="color:#111;background:red">x</div>');
});

test("legacy summary/desc/chips/tags fold into an equivalent sanitized body", () => {
  const html = legacyCardBody({ summary: "Sum <b>", desc: "Desc", chips: [{ key: "CK", value: "tenant", color: "#123456" }], tags: ["MERGE", { text: "APPEND", color: "#00ff00" }] });
  assert.ok(html.includes("Sum &lt;b&gt;"), "legacy text is escaped, not interpreted");
  assert.equal(sanitizeCardBody(html), html, "the legacy output is already clean");
  const file = {
    name: "t",
    nodes: [{ id: "k", type: "card", title: "Feature", summary: "One line", chips: [{ key: "CK", value: "v" }], size: [240, 60] }],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  const written = JSON.parse(serializeArchitecture(schema, schema.layout).replace(/```json\n|\n```\n?/g, ""));
  const k = written.nodes.find((n: { id: string }) => n.id === "k");
  assert.equal(k.summary, undefined, "legacy summary is no longer written");
  assert.equal(k.chips, undefined, "legacy chips are no longer written");
  assert.ok(String(k.body).includes("One line") && String(k.body).includes("CK"), "the folded body is written");
  // Second pass is stable.
  const again = serializeArchitecture(parseArchitecture(serializeArchitecture(schema, schema.layout)), parseArchitecture(serializeArchitecture(schema, schema.layout)).layout);
  assert.equal(again, serializeArchitecture(schema, schema.layout));
});

test("a card body round-trips and its height reserves the body's measured lines", () => {
  const body = "<p>First paragraph of the card body that is long enough to wrap onto several lines at the default width.</p><ul><li>one</li><li>two</li></ul>";
  const file = { name: "t", nodes: [{ id: "b", type: "card", title: "Body", body, size: [260, 40] }], edges: [] };
  const schema = parseArchitecture(tab(file));
  const out = serializeArchitecture(schema, schema.layout);
  const written = JSON.parse(out.replace(/```json\n|\n```\n?/g, ""));
  assert.equal(written.nodes[0].body, body, "authored body round-trips verbatim");
  const short = cardLayout({ title: "Body", body: "<p>one line</p>" } as never, { w: 260 });
  const long = cardLayout({ title: "Body", body } as never, { w: 260 });
  assert.ok(long.bodyH > short.bodyH, "more text, more reserved height");
  assert.ok(long.h > short.h);
  assert.equal(cardLayout({ title: "Body" } as never, { w: 260 }).centered, true, "no body → title-only label");
});

test("html block sanitizer keeps headings, grid/flex layout, shadows and gradients", () => {
  const keep = '<h2 style="font-size:16px">Title</h2><blockquote>q</blockquote>x<sub>2</sub><sup>3</sup>';
  assert.equal(sanitizeDiagramHtml(keep), keep);
  const grid = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">a</div>';
  assert.equal(sanitizeDiagramHtml(grid), grid);
  const flex = '<div style="display:flex;flex-wrap:wrap;flex-direction:column">a</div>';
  assert.equal(sanitizeDiagramHtml(flex), flex);
  const fx = '<div style="box-shadow:0 2px 4px rgba(0,0,0,.2);background:linear-gradient(90deg,#094074,#FE9000)">a</div>';
  assert.equal(sanitizeDiagramHtml(fx), fx);
  assert.equal(sanitizeCardStyle("grid-template-columns:url(http://e/x)"), "", "url() is never allowed");
  assert.equal(sanitizeCardStyle("background:linear-gradient(url(x),#fff)"), "", "url() inside a gradient is dropped");
  assert.equal(sanitizeCardStyle("box-shadow:url(x) 0 0 2px"), "");
  assert.equal(sanitizeCardStyle("flex-wrap:banana"), "", "enumerated values are checked");
  assert.equal(sanitizeCardStyle("flex-direction:row;overflow:hidden;z-index:9;position:sticky"), "flex-direction:row", "overflow / z-index / position are not allowed");
  assert.equal(sanitizeCardStyle("grid-column:1 / span 2"), "", "a slash is not a plain value");
  assert.equal(sanitizeCardStyle("min-height:40px;max-width:100%"), "min-height:40px;max-width:100%");
  assert.equal(sanitizeCardStyle("height:calc(100% - 4px)"), "");
});

test("html block sanitizer neutralises hostile payloads in the free-form tags and styles", () => {
  const hostile = [
    "<h1 onclick=alert(1)>x</h1>",
    '<blockquote style="background:url(http://evil.example/x)">x</blockquote>',
    '<div style="display:grid;grid-template-columns:url(http://evil.example/x)"><img src=x onerror=alert(1)></div>',
    '<div style="display:grid;grid-template-columns:repeat(3,1fr)"><svg onload=alert(1)></svg></div>',
    '<h2><a href="javascript:alert(1)">x</a></h2>',
    '<sub onmouseover=alert(1)>x</sub>',
    '<div style="box-shadow:url(http://evil.example/x)">x</div>',
    '<div style="background:linear-gradient(url(http://evil.example/x),red)">x</div>',
    '<div style="position:absolute;top:0">x</div>',
    '<div style="flex-direction:row;position:fixed">x</div>',
    '<table><tr><td><iframe src="javascript:alert(1)"></iframe></td></tr></table>',
    '<h3><form action="javascript:alert(1)"><button>b</button></form></h3>',
    '<div style="min-height:10px"><script>alert(1)</script></div>',
    '<div style="display:grid"><h4 style="grid-column:1/3">x</h4></div>',
    '<ol><li><object data="javascript:alert(1)"></object></li></ol>',
  ];
  for (const h of hostile) {
    const out = sanitizeDiagramHtml(h).toLowerCase();
    for (const bad of ["<script", "<svg", "<img", "<iframe", "<object", "<form", "<button", "<a ", "<a>", "onerror", "onclick", "onload", "onmouseover", "javascript:", "url(", "expression", "position", "srcdoc", "href=", "!important", "<style", "grid-column", "&#"]) {
      assert.equal(out.includes(bad), false, `"${bad}" survived: ${h} -> ${out}`);
    }
  }
});

test("an html block round-trips verbatim (html + frame) and its size is measured from the HTML", () => {
  const html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><div>98%</div><div>1.2M</div><div>240 ms</div></div>';
  const file = {
    name: "t",
    nodes: [
      { id: "anno-html-k", type: "html", at: [200, 100], html, style: { padding: 6, fill: "#F8FAFC" } },
      { id: "anno-html-s", type: "html", at: [200, 300], html: "<h2>Timeline</h2><ol><li>Kick off</li><li>Build</li><li>Ship</li></ol>", size: [260, 40] },
    ],
    edges: [],
  };
  const schema = parseArchitecture(tab(file));
  const out = serializeArchitecture(schema, schema.layout);
  const written = JSON.parse(out.replace(/```json\n|\n```\n?/g, ""));
  const k = written.nodes.find((n: { id: string }) => n.id === "anno-html-k");
  assert.equal(k.type, "html");
  assert.equal(k.html, html, "the html round-trips verbatim");
  assert.equal(k.style.padding, 6, "frame padding round-trips in the node style");
  assert.equal(k.style.fill, "#F8FAFC", "the frame fill round-trips");
  const again = parseArchitecture(out);
  assert.equal(serializeArchitecture(again, again.layout), out, "a second pass is byte-stable");
  assert.equal(schema.layout.nodes["anno-html-s"].w, 260, "an explicit size sets the width");
  assert.ok(schema.layout.nodes["anno-html-s"].h >= 40, "an explicit size height is a floor");
  assert.equal(validateArchitecture(tab(file)).filter((i) => i.field === "type").length, 0, "html is a known node type");
  // Placement: a box that wraps an html block grows around it (pad on every side).
  const wrapped = parseArchitecture(tab({ name: "t", nodes: [
    { id: "box", type: "box", wraps: ["h"], pad: 10 },
    { id: "h", type: "html", at: [200, 200], html: "<p>x</p>", size: [200, 40] },
  ], edges: [] }));
  assert.equal(wrapped.layout.nodes.box.w, 220, "the wrapping box is the block's width plus the pad, each side");
  assert.equal(wrapped.layout.nodes.box.h, 60, "and its height plus the pad, each side");
});

test("html block height: the estimator lays a grid out as cells, pads blocks, and keeps the size floor", () => {
  const cells = "<div>98%</div><div>1.2M</div><div>240 ms</div>";
  const grid = cardBodyContentH(`<div style="display:grid;grid-template-columns:repeat(3,1fr)">${cells}</div>`, 300);
  const stacked = cardBodyContentH(cells, 300);
  assert.ok(grid < stacked, `three grid cells are one row, not a stack (${grid} vs ${stacked})`);
  const padded = cardBodyContentH('<div style="padding:10px">x</div>', 200);
  const plain = cardBodyContentH("<div>x</div>", 200);
  assert.equal(padded - plain, 20, "a padded block reserves both insets");
  const short = htmlBlockLayout("<p>one</p>", { w: 260 });
  const long = htmlBlockLayout(`<p>${"word ".repeat(120)}</p>`, { w: 260 });
  assert.ok(long.h > short.h * 3, "more text, more height");
  const longLine = "word ".repeat(30);
  assert.equal(
    cardBodyContentH(`<div style="white-space:nowrap">${longLine}</div>`, 120),
    cardBodyContentH("<div>word</div>", 120),
    "white-space:nowrap text is one line, however long",
  );
  assert.equal(htmlBlockLayout("", { w: 200, h: 90 }).h, 90, "an empty block keeps its size floor");
  assert.equal(htmlBlockLayout("", undefined, 0).h, HTML_BLOCK_MIN_H, "an empty block has the minimum height");
  assert.equal(htmlBlockLayout(undefined).w, HTML_BLOCK_DEFAULT_W, "the default width");
  assert.equal(naturalSize("html", undefined, undefined, { html: "<p>one</p>" } as never).h, short.h, "naturalSize measures the same way");
  // A heading renders larger than body text, so it is measured larger.
  assert.ok(cardBodyContentH("<h1>Title</h1>", 200) > cardBodyContentH("<p>Title</p>", 200), "headings are measured at their size");
});

// --- same-side loops, equal-height stage rows, corridor labels -------------

test("a bottom-to-bottom loop runs beyond the box it would cross, and only then", () => {
  // Bottom anchors at y=100; a box spans y 50..150 under the run's x-span.
  const blocker = { x: -20, y: 50, w: 260, h: 100 };
  const sp = { x: 0, y: 100 }, tp = { x: 200, y: 100 };
  const runY = turnClearY("b", "b", sp, tp, [blocker]);
  assert.equal(runY, 162, "the run drops to just below the box bottom (150 + 12)");
  assert.equal(stubOffset("b", "b", sp, tp, runY), 62, "the offset IS the run depth");
  assert.equal(turnClearY("b", "b", sp, tp, [{ x: 400, y: 50, w: 50, h: 100 }]), undefined, "a box off the run's x-span is not crossed");
  assert.equal(turnClearY("r", "l", sp, tp, [blocker]), undefined, "only same-side U-turns are deepened");
  assert.equal(stubOffset("r", "l", { x: 0, y: 0 }, { x: 500, y: 0 }, 300), 20, "a turn Y never changes a side-to-side stub");
});

test("sibling stage boxes in one row share the tallest height", () => {
  const file = {
    name: "stages", theme: "slide", rowGrid: true, columns: ["s1", "s2"],
    nodes: [
      { id: "c1", type: "card", title: "a", size: [200, 60], col: "s1", row: 1 },
      { id: "c2", type: "card", title: "b", size: [200, 60], col: "s1", row: 2 },
      { id: "c3", type: "card", title: "c", size: [200, 60], col: "s2", row: 1 },
      { id: "st1", type: "box", title: "One", wraps: ["c1", "c2"] },
      { id: "st2", type: "box", title: "Two", wraps: ["c3"] },
    ],
    edges: [],
  };
  const boxes = computeLayout(file as never);
  const a = boxes.get("st1")!, b = boxes.get("st2")!;
  assert.equal(a.h, b.h, "the two-card stage grows to the one-card stage's height");
  assert.equal(a.y - a.h / 2, b.y - b.h / 2, "tops still line up");
  // A pinned box keeps its own height: explicit placement is never overridden.
  const pinned = computeLayout({ ...file, nodes: [...file.nodes.slice(0, 3), file.nodes[3], { id: "st2", type: "box", title: "Two", wraps: ["c3"], at: [900, 300], size: [240, 40] }] } as never);
  assert.notEqual(pinned.get("st1")!.h, pinned.get("st2")!.h, "an explicitly placed box is left alone");
});

test("a label wider than its corridor leaves the line instead of clipping a tile", () => {
  // Two tiles 40px apart: the chip (84px) cannot sit between them on its line. The old search
  // kept the least-bad on-line slot, which covers a tile edge. It must find a clean slot off it.
  const l = lookup({ a: [0, 0, 120, 60], b: [160, 0, 120, 60] });
  const edges = [{ id: "e1", source: "a", target: "b", label: "Read/write" }];
  const r = labelRectOf(edges, l, "e1");
  assert.ok(!overlaps(r, rectOfNode(l, "a"), 0), "clear of the source tile");
  assert.ok(!overlaps(r, rectOfNode(l, "b"), 0), "clear of the target tile");
  assert.equal(computeLabelOffsets(edges, l as never).get("e1")!.leader, true, "and it is led back to the line");
});

console.log(`Diagram layout tests passed (${passed} cases).`);
