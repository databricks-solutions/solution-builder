/**
 * platform-diagram/shape-geometry — the pure SVG geometry for `shape`
 * annotations (the flowchart vocabulary: process, decision, terminator, data,
 * store, document, …).
 *
 * Why a separate module: the renderer (`annotations.tsx`) needs a path string,
 * but so does anything that wants to reason about a shape offline — and a path
 * built inline in JSX can't be unit-tested. These functions are pure (numbers in,
 * path string out), so `test:layout` asserts them directly.
 *
 * Two rules that keep every shape looking right at any size:
 *
 *   • DRAW IN THE NODE'S OWN PIXEL BOX, not a fixed viewBox that gets scaled.
 *     A `viewBox="0 0 100 100"` on a 320×90 node stretches the stroke (a 2px
 *     border renders ~6px thick on one axis and ~0.6px on the other) and turns a
 *     diamond's crisp corners into soft ones. So the SVG is sized w×h and the
 *     geometry is computed in those same units — the stroke is then uniform and
 *     the corners stay sharp however the user resizes it.
 *
 *   • INSET BY HALF THE STROKE. An SVG stroke straddles the path, so a shape
 *     drawn to the exact edge loses the outer half of its border to the viewport
 *     bounds (visibly thinner on all four sides, and clipped at the corners).
 *     Every shape is inset by `stroke / 2` so the border renders in full.
 *
 * Shapes are drawn as a single `d` path (not <polygon>/<ellipse> elements) so the
 * renderer has ONE code path for every kind — fill, stroke, dash and rotation all
 * behave identically, and adding a kind never touches the renderer.
 */

/** The flowchart shape vocabulary. `rectangle`/`rounded` overlap the existing
 *  `box` annotation deliberately: `box` is a CONTAINER (title bar, wraps
 *  children, auto-sizes around them), while a `shape` is a FLOW STEP that
 *  happens to be rectangular. Keeping both means a process flow doesn't
 *  accidentally inherit container behaviour. */
export type ShapeKind =
  | "rectangle"
  | "rounded"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "parallelogram"
  | "hexagon"
  | "cylinder"
  | "document"
  | "chevron";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle", "rounded", "ellipse", "diamond", "triangle",
  "parallelogram", "hexagon", "cylinder", "document", "chevron",
] as const;

export const DEFAULT_SHAPE_KIND: ShapeKind = "rounded";

/** Human labels for the palette + the edit panel's shape picker. */
export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rectangle: "Rectangle",
  rounded: "Process",
  ellipse: "Start / end",
  diamond: "Decision",
  triangle: "Triangle",
  parallelogram: "Input / output",
  hexagon: "Preparation",
  cylinder: "Data store",
  document: "Document",
  chevron: "Phase header",
};

/** Corner radius for `rounded`, as a fraction of the SHORT axis — so a wide
 *  process box and a small one look like the same shape family. Capped in px so
 *  a very tall node doesn't turn into a stadium. */
const ROUNDED_R_RATIO = 0.18;
const ROUNDED_R_MAX = 18;
/** How far a parallelogram's top edge is pushed right (fraction of width). */
const SKEW_RATIO = 0.16;
const SKEW_MAX = 40;
/** How far a hexagon's angled ends cut in (fraction of width). */
const HEX_RATIO = 0.14;
const HEX_MAX = 34;
/** A cylinder's elliptical cap depth (fraction of height). */
const CAP_RATIO = 0.16;
const CAP_MAX = 26;
/** A document's wave depth (fraction of height). */
const WAVE_RATIO = 0.12;
const WAVE_MAX = 22;
/** A chevron's arrow depth (fraction of WIDTH — not height, unlike hexagon's cut,
 *  because a phase header is wide and short and the point must stay a shallow
 *  arrow rather than a spike). Measured off the reference decks: their phase
 *  chevrons run ~24-32px of point on a ~380px banner. */
const CHEV_RATIO = 0.07;
const CHEV_MAX = 32;

const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
/** Trim to 2dp and drop a trailing ".00" so path strings stay readable + stable
 *  (a snapshot/round-trip test compares them). */
const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export interface ShapePathOpts {
  /** Node box in px (the RotatableCard's w/h). */
  w: number;
  h: number;
  /** Stroke width in px (0 = no border). Used for the half-stroke inset. */
  stroke?: number;
}

/**
 * The SVG `d` path for one shape kind, drawn inside a `w`×`h` box and inset by
 * half the stroke. Always a closed path, so `fill` works for every kind.
 *
 * Degenerate sizes are handled rather than producing `NaN`/inverted geometry: a
 * box smaller than the stroke collapses to its centre instead of drawing a path
 * with negative extents (which some renderers fill inside-out).
 */
export function shapePath(kind: ShapeKind, { w, h, stroke = 0 }: ShapePathOpts): string {
  const inset = stroke / 2;
  // Keep at least a hairline of drawable area at any size.
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0, w - inset);
  const y1 = Math.max(y0, h - inset);
  const iw = x1 - x0;
  const ih = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const short = Math.min(iw, ih);

  switch (kind) {
    case "rectangle":
      return `M ${n(x0)} ${n(y0)} L ${n(x1)} ${n(y0)} L ${n(x1)} ${n(y1)} L ${n(x0)} ${n(y1)} Z`;

    case "rounded": {
      const r = clamp(short * ROUNDED_R_RATIO, Math.min(ROUNDED_R_MAX, short / 2));
      if (r <= 0) return shapePath("rectangle", { w, h, stroke });
      return [
        `M ${n(x0 + r)} ${n(y0)}`,
        `L ${n(x1 - r)} ${n(y0)}`,
        `Q ${n(x1)} ${n(y0)} ${n(x1)} ${n(y0 + r)}`,
        `L ${n(x1)} ${n(y1 - r)}`,
        `Q ${n(x1)} ${n(y1)} ${n(x1 - r)} ${n(y1)}`,
        `L ${n(x0 + r)} ${n(y1)}`,
        `Q ${n(x0)} ${n(y1)} ${n(x0)} ${n(y1 - r)}`,
        `L ${n(x0)} ${n(y0 + r)}`,
        `Q ${n(x0)} ${n(y0)} ${n(x0 + r)} ${n(y0)}`,
        "Z",
      ].join(" ");
    }

    case "ellipse": {
      const rx = iw / 2;
      const ry = ih / 2;
      // Two arcs — a full ellipse as one closed path (a single 360° arc is a
      // no-op in SVG because start == end).
      return [
        `M ${n(x0)} ${n(cy)}`,
        `A ${n(rx)} ${n(ry)} 0 0 1 ${n(x1)} ${n(cy)}`,
        `A ${n(rx)} ${n(ry)} 0 0 1 ${n(x0)} ${n(cy)}`,
        "Z",
      ].join(" ");
    }

    case "diamond":
      return `M ${n(cx)} ${n(y0)} L ${n(x1)} ${n(cy)} L ${n(cx)} ${n(y1)} L ${n(x0)} ${n(cy)} Z`;

    case "triangle":
      return `M ${n(cx)} ${n(y0)} L ${n(x1)} ${n(y1)} L ${n(x0)} ${n(y1)} Z`;

    case "parallelogram": {
      const s = clamp(iw * SKEW_RATIO, Math.min(SKEW_MAX, iw / 2));
      return `M ${n(x0 + s)} ${n(y0)} L ${n(x1)} ${n(y0)} L ${n(x1 - s)} ${n(y1)} L ${n(x0)} ${n(y1)} Z`;
    }

    case "hexagon": {
      const s = clamp(iw * HEX_RATIO, Math.min(HEX_MAX, iw / 2));
      return [
        `M ${n(x0 + s)} ${n(y0)}`,
        `L ${n(x1 - s)} ${n(y0)}`,
        `L ${n(x1)} ${n(cy)}`,
        `L ${n(x1 - s)} ${n(y1)}`,
        `L ${n(x0 + s)} ${n(y1)}`,
        `L ${n(x0)} ${n(cy)}`,
        "Z",
      ].join(" ");
    }
    // PHASE HEADER. A hexagon points BOTH ways (it reads as "preparation", a
     // symmetric step); a chevron points ONE way, which is what makes a row of them
     // read as a SEQUENCE — "Data Preparation › Training › Inference › Monitoring".
     // That banner row is the single biggest structural difference between our output
     // and the Databricks deck slides: it names and groups the columns, which is what
     // lets the tiles underneath sit tightly without the reader losing the grouping
     // (Gestalt proximity needs CONTRAST, and a named band supplies it without gaps).
    case "chevron": {
      const s = clamp(iw * CHEV_RATIO, Math.min(CHEV_MAX, iw / 2));
      return [
        `M ${n(x0)} ${n(y0)}`,
        `L ${n(x1 - s)} ${n(y0)}`,
        `L ${n(x1)} ${n(cy)}`,      // the point
        `L ${n(x1 - s)} ${n(y1)}`,
        `L ${n(x0)} ${n(y1)}`,
        `L ${n(x0 + s)} ${n(cy)}`,  // the notch, so a row of them interlocks
        "Z",
      ].join(" ");
    }

    case "cylinder": {
      // A database drum: elliptical top cap, straight sides, elliptical bottom.
      const c = clamp(ih * CAP_RATIO, Math.min(CAP_MAX, ih / 2));
      const rx = iw / 2;
      return [
        `M ${n(x0)} ${n(y0 + c)}`,
        `A ${n(rx)} ${n(c)} 0 0 1 ${n(x1)} ${n(y0 + c)}`,
        `L ${n(x1)} ${n(y1 - c)}`,
        `A ${n(rx)} ${n(c)} 0 0 1 ${n(x0)} ${n(y1 - c)}`,
        "Z",
      ].join(" ");
    }

    case "document": {
      // Flat top, wavy bottom (the classic "document" symbol).
      const v = clamp(ih * WAVE_RATIO, Math.min(WAVE_MAX, ih / 3));
      return [
        `M ${n(x0)} ${n(y0)}`,
        `L ${n(x1)} ${n(y0)}`,
        `L ${n(x1)} ${n(y1 - v)}`,
        `Q ${n(x0 + iw * 0.75)} ${n(y1 - v * 2)} ${n(cx)} ${n(y1 - v)}`,
        `Q ${n(x0 + iw * 0.25)} ${n(y1)} ${n(x0)} ${n(y1 - v)}`,
        "Z",
      ].join(" ");
    }
  }
}

/**
 * Inner box where a shape's TEXT can safely sit, as insets from the node box.
 *
 * A pointed shape can't take text edge-to-edge: a diamond's corners and a
 * triangle's apex are empty, so centred text drawn across the full width spills
 * outside the outline. This returns the padding the label needs per kind — the
 * label is then a normal flex box inside those insets, so alignment, wrapping and
 * font size all keep working.
 *
 * The fractions are the inscribed-box geometry, loosened slightly: a diamond's
 * true inscribed rect is w/2 × h/2 (25% inset each side), which is correct but
 * cramped for a word like "Approved?", so it's 22%.
 */
export function shapeTextInset(kind: ShapeKind, { w, h }: { w: number; h: number }): {
  top: number; right: number; bottom: number; left: number;
} {
  const pad = 6;
  switch (kind) {
    case "diamond":
      return { top: h * 0.22, right: w * 0.22, bottom: h * 0.22, left: w * 0.22 };
    case "triangle":
      // Usable area is the bottom half; the apex is unusable.
      return { top: h * 0.45, right: w * 0.18, bottom: pad, left: w * 0.18 };
    case "parallelogram": {
      const s = clamp(w * SKEW_RATIO, SKEW_MAX);
      return { top: pad, right: s + pad, bottom: pad, left: s + pad };
    }
    case "hexagon": {
      const s = clamp(w * HEX_RATIO, HEX_MAX);
      return { top: pad, right: s + pad, bottom: pad, left: s + pad };
    }
    // Inset BOTH ends: the right by the point, the left by the notch, so a centred
    // phase label never runs into either and a row of chevrons keeps its labels on
    // one optical line.
    case "chevron": {
      const s = clamp(w * CHEV_RATIO, CHEV_MAX);
      return { top: pad, right: s + pad, bottom: pad, left: s + pad };
    }
    case "cylinder": {
      const c = clamp(h * CAP_RATIO, CAP_MAX);
      return { top: c + pad, right: pad, bottom: c + pad, left: pad };
    }
    case "document": {
      const v = clamp(h * WAVE_RATIO, WAVE_MAX);
      return { top: pad, right: pad, bottom: v + pad, left: pad };
    }
    case "ellipse":
      // Inscribed rect of an ellipse is ~70% on each axis → ~15% inset.
      return { top: h * 0.15, right: w * 0.15, bottom: h * 0.15, left: w * 0.15 };
    case "rectangle":
    case "rounded":
      return { top: pad, right: pad, bottom: pad, left: pad };
  }
}
