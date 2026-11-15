/**
 * platform-diagram/md-format — pure markdown formatting for annotation text.
 *
 * The right-hand edit panel's Bold / Italic / Bullet / Title buttons (and ⌘B /
 * ⌘I in the editor) call `applyMdFormat` on the editing textarea's value +
 * selection. Every action is a TOGGLE: applying it to text that already has it
 * removes it, so the buttons behave like a word processor's.
 *
 * Kept free of React so the rules are unit-tested (scripts/test-diagram-layout.ts).
 */
export type MdFormat = "bold" | "italic" | "bullet" | "heading";

export interface MdEdit {
  value: string;
  /** New selection, so the caller can restore it after the state update. */
  start: number;
  end: number;
}

/** A list / heading marker at the start of a line — skipped by inline formats
 *  so `**` wraps the words, not the `- ` bullet. */
const LINE_PREFIX = /^(\s*(?:[-*+]|\d+\.)\s+|#{1,6}\s+)/;
const BULLET = /^(\s*)[-*+]\s+/;
const NUMBERED = /^(\s*)\d+\.\s+/;
const HEADING = /^#{1,6}\s+/;
const HEADING_MARK = "## ";

interface Line { start: number; end: number; text: string }

function linesOf(value: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const text of value.split("\n")) {
    out.push({ start: at, end: at + text.length, text });
    at += text.length + 1;
  }
  return out;
}

/** The lines a selection touches. A selection ending exactly at the start of a
 *  line (a triple-click selects the trailing newline) doesn't include it. */
function touchedLines(value: string, start: number, end: number): Line[] {
  const lines = linesOf(value);
  const last = end > start ? end - 1 : end;
  return lines.filter((l) => l.end >= start && l.start <= last);
}

/** Expand a collapsed caret to the word under it (word-processor behaviour). */
function wordAt(value: string, at: number): [number, number] {
  const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_'’-]/u.test(c);
  let s = at, e = at;
  while (isWord(value[s - 1])) s--;
  while (isWord(value[e])) e++;
  return [s, e];
}

function starRun(value: string, from: number, dir: -1 | 1): number {
  let n = 0;
  for (let i = dir < 0 ? from - 1 : from; value[i] === "*"; i += dir) n++;
  return n;
}

function inlineFormat(value: string, start: number, end: number, kind: "bold" | "italic"): MdEdit {
  const mark = kind === "bold" ? "**" : "*";
  if (start === end) {
    [start, end] = wordAt(value, start);
    if (start === end) {
      // Nothing to wrap: insert an empty pair with the caret inside it.
      const v = value.slice(0, start) + mark + mark + value.slice(start);
      return { value: v, start: start + mark.length, end: start + mark.length };
    }
  }

  // One segment per touched line: emphasis can't span list items / paragraphs.
  // Each segment skips the line's list/heading prefix and surrounding spaces,
  // and any `*` markers inside the selection (so selecting "**x**" works too).
  const segs: Array<{ s: number; e: number }> = [];
  for (const l of touchedLines(value, start, end)) {
    let s = Math.max(start, l.start);
    let e = Math.min(end, l.end);
    if (s === l.start) s += (LINE_PREFIX.exec(l.text)?.[0].length ?? 0);
    while (s < e && /\s/.test(value[s])) s++;
    while (e > s && /\s/.test(value[e - 1])) e--;
    // Markers are never content: a selection spanning lines ends up covering a
    // closing "**" on one line and an opening one on the next, so strip each
    // side on its own, not as a pair.
    while (s < e && value[s] === "*") s++;
    while (e > s && value[e - 1] === "*") e--;
    if (s < e) segs.push({ s, e });
  }
  if (!segs.length) return { value, start, end };

  const has = ({ s, e }: { s: number; e: number }) => {
    const before = starRun(value, s, -1);
    const after = starRun(value, e, 1);
    // `**x**` is bold, `*x*` italic, `***x***` both.
    return kind === "bold" ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1;
  };
  const remove = segs.every(has);

  let v = value;
  let newStart = segs[0].s;
  let newEnd = segs[segs.length - 1].e;
  // Right-to-left so earlier offsets stay valid.
  for (let i = segs.length - 1; i >= 0; i--) {
    const { s, e } = segs[i];
    if (remove) {
      v = v.slice(0, s - mark.length) + v.slice(s, e) + v.slice(e + mark.length);
    } else if (!has(segs[i])) {
      v = v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e);
    }
  }
  // Recompute the selection over the (un)wrapped words.
  let shift = 0;
  for (let i = 0; i < segs.length; i++) {
    const changed = remove || !has(segs[i]);
    const delta = changed ? (remove ? -mark.length : mark.length) : 0;
    if (i === 0) newStart = segs[0].s + shift + delta;
    if (i === segs.length - 1) newEnd = segs[i].e + shift + delta;
    shift += delta * 2;
  }
  return { value: v, start: newStart, end: newEnd };
}

function lineFormat(value: string, start: number, end: number, kind: "bullet" | "heading"): MdEdit {
  const touched = touchedLines(value, start, end);
  const content = touched.filter((l) => l.text.trim());
  const is = (t: string) => (kind === "bullet" ? BULLET.test(t) : HEADING.test(t));
  const remove = content.length > 0 && content.every((l) => is(l.text));

  const rewrite = (t: string): string => {
    if (!t.trim()) return t;
    if (remove) return kind === "bullet" ? t.replace(BULLET, "$1") : t.replace(HEADING, "");
    if (is(t)) return t;
    // Switching kinds replaces the other marker instead of stacking them.
    const bare = t.replace(HEADING, "").replace(BULLET, "$1").replace(NUMBERED, "$1");
    if (kind === "heading") return HEADING_MARK + bare.trimStart();
    const indent = /^\s*/.exec(bare)![0];
    return indent + "- " + bare.slice(indent.length);
  };

  const first = touched[0];
  const last = touched[touched.length - 1];
  const block = touched.map((l) => rewrite(l.text)).join("\n");
  const v = value.slice(0, first.start) + block + value.slice(last.end);
  return { value: v, start: first.start, end: first.start + block.length };
}

/** Toggle `kind` on the selection [start, end) of `value`. */
export function applyMdFormat(value: string, start: number, end: number, kind: MdFormat): MdEdit {
  const s = Math.max(0, Math.min(start, end, value.length));
  const e = Math.min(value.length, Math.max(start, end));
  return kind === "bold" || kind === "italic"
    ? inlineFormat(value, s, e, kind)
    : lineFormat(value, s, e, kind);
}
