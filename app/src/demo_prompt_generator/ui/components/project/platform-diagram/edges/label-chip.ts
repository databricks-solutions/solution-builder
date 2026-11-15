/**
 * platform-diagram/edges/label-chip — the geometry of the edge-label pill.
 *
 * ONE definition shared by the RENDERER (`flow-edge` draws the pill) and the
 * PLACEMENT pass (`label-layout` reserves space for it). If the two ever drift,
 * the solver silently reserves the wrong box and its collision numbers become
 * fiction — so both import from here and neither hard-codes a metric.
 *
 * SIZE. The constants below are the metrics at the reference font
 * (`EDGE_LABEL_FONT` = 11px). Every metric scales linearly with the font, so a
 * tab's `options.edgeLabelSize` changes the pill in BOTH consumers through the same
 * `chipMetrics(font)` call. The wrap width scales too, so a bigger label wraps at
 * the same number of characters per line instead of growing into a wider pill
 * that the solver can't place.
 *
 * Why wrapping exists: the pill used to be SINGLE-LINE with unbounded width, so a
 * 35-character label became a ~234px chip. Placement can slide a chip along its
 * line but it cannot fit one WIDER THAN THE CORRIDOR, so those labels stayed on
 * top of a tile no matter how good the search was (measured on the mlops-v2
 * diagram: the one violation the solver couldn't clear). Wrapping to ~140px
 * roughly halves the area and, more importantly, makes the chip narrow enough to
 * fit the gaps where it previously could not.
 *
 * The line count here is EXACT, not estimated: we own the wrap, so we simply
 * count the lines it produces. (An implementation that estimates lines from a
 * width ratio must round up, because word wrapping breaks a line before it is
 * full — we avoid that class of bug entirely by wrapping for real.)
 */

/** The font the reference metrics below were measured at (px). */
export const EDGE_LABEL_FONT = 11;
/** Mean advance per character at the reference 11px size (weight 500). */
export const CHAR_W = 7.4;
/** Line box height for wrapped text at the reference size. */
export const LINE_H = 13;
/** Horizontal padding + border inside the pill (reference size). */
export const CHIP_PAD_X = 10;
/** Vertical padding, tuned so a ONE-line chip stays about 16px tall while
 *  the larger 11px label remains readable. */
export const CHIP_PAD_Y = 1.5;
/** Wrap width for the TEXT at the reference size (the chip itself is this +
 *  CHIP_PAD_X). The wider cap preserves short 23–24 character labels at 11px. */
export const MAX_TEXT_W = 180;
/** Hard cap on lines. Past this the last line is ellipsized and the full text
 *  goes to the chip's tooltip, so nothing is actually lost. */
export const MAX_LINES = 3;

/** The pill's metrics at a given font size. Every field scales with `font`. */
export interface ChipMetrics {
  font: number;
  charW: number;
  lineH: number;
  padX: number;
  padY: number;
  maxTextW: number;
}

/** Metrics for a chip at `font` px. The default reproduces the reference metrics
 *  exactly, so an untouched diagram measures the same as before. */
export function chipMetrics(font: number = EDGE_LABEL_FONT): ChipMetrics {
  const k = font / EDGE_LABEL_FONT;
  return {
    font,
    charW: CHAR_W * k,
    lineH: LINE_H * k,
    padX: CHIP_PAD_X * k,
    padY: CHIP_PAD_Y * k,
    maxTextW: MAX_TEXT_W * k,
  };
}

/**
 * Greedy word wrap to the chip's text width, clamped to `MAX_LINES`.
 *
 * A single word longer than the wrap width is NOT broken — hyphenating a table
 * or product name mid-word reads worse than a slightly over-wide chip.
 * Returns at least one line for any non-empty input.
 */
export function wrapLabel(label: string, font: number = EDGE_LABEL_FONT): string[] {
  const m = chipMetrics(font);
  const textWidth = (s: string): number => s.length * m.charW;
  const text = String(label ?? "").trim();
  if (!text) return [];
  if (textWidth(text) <= m.maxTextW) return [text];

  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (textWidth(candidate) <= m.maxTextW) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1]}…`;
  return kept;
}

/** True when `wrapLabel` had to drop content (so the caller should add a tooltip). */
export function isClamped(label: string, font: number = EDGE_LABEL_FONT): boolean {
  const lines = wrapLabel(label, font);
  return lines.length === MAX_LINES && lines[MAX_LINES - 1].endsWith("…");
}

/** Outer size of the pill for a set of wrapped lines at `font`. */
export function chipSize(lines: string[], font: number = EDGE_LABEL_FONT): { w: number; h: number } {
  if (lines.length === 0) return { w: 0, h: 0 };
  const m = chipMetrics(font);
  const widest = Math.max(...lines.map((l) => l.length * m.charW));
  return {
    w: widest + m.padX,
    h: lines.length * m.lineH + m.padY * 2,
  };
}

/** Centre-line Y of wrapped line `i` within a chip of height `h`, relative to the
 *  chip's centre (which is where `flow-edge` translates to). */
export function lineCenterY(i: number, h: number, font: number = EDGE_LABEL_FONT): number {
  const m = chipMetrics(font);
  return -h / 2 + m.padY + m.lineH * i + m.lineH / 2;
}

/** Convenience: wrap + measure in one call. `font` is the chip's font size in px. */
export function measureLabel(label: string, font: number = EDGE_LABEL_FONT): { lines: string[]; w: number; h: number } {
  const lines = wrapLabel(label, font);
  return { lines, ...chipSize(lines, font) };
}
