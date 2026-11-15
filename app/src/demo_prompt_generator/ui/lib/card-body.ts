/**
 * card-body — the HTML body every diagram HTML surface draws: a card's body and the
 * free-form `html` annotation. The ONE sanitizer every such body passes through
 * before it reaches the DOM, plus the legacy → body conversion and the body's
 * pure parse (used by the height estimator in platform-architecture).
 *
 * The body is author-controlled HTML (the author, the agent, or a live collaborator
 * writes it in architecture.md). It is rendered with dangerouslySetInnerHTML, so
 * `sanitizeDiagramHtml` is the ONLY path to the DOM:
 *   • tags: a short allow-list of text/layout tags; anything else is dropped (its
 *     text content is kept), and script/style/iframe/svg/… are dropped WITH their
 *     content;
 *   • attributes: `style` only, and only allow-listed CSS properties with plain
 *     values (no url(), no expression(), no `&` entities, no `!important`, no
 *     position — nothing can escape its node or load a resource);
 *   • text: a bare `<` is escaped, so nothing can open a new tag.
 * It is pure (no DOM), so `bun run test:layout` exercises it directly.
 */

/** Tags a diagram HTML body may use. Everything else is dropped (text kept). */
export const DIAGRAM_HTML_TAGS: ReadonlySet<string> = new Set([
  "div", "span", "p", "br", "b", "strong", "i", "em", "u", "small", "code", "sub", "sup",
  "h1", "h2", "h3", "h4", "blockquote",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "hr",
]);
/** Back-compat name (cards). */
export const CARD_BODY_TAGS = DIAGRAM_HTML_TAGS;

/** Tags dropped together with everything inside them. */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "textarea", "title", "xmp", "noembed", "noframes", "plaintext", "select", "option", "form", "frameset", "frame"];

/** CSS properties a diagram HTML body may set. Layout (flex/grid, sizing), type and
 *  colour, plus box-shadow and gradients via `background`. Never position, overflow,
 *  z-index, or anything that loads a resource (url() is rejected by the value rules). */
export const DIAGRAM_HTML_CSS: ReadonlySet<string> = new Set([
  "color", "background", "background-color", "border", "border-top", "border-bottom", "border-left", "border-right",
  "border-color", "border-width", "border-style", "border-radius", "padding", "padding-top", "padding-bottom",
  "padding-left", "padding-right", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "font-size", "font-weight", "font-style", "text-align", "text-decoration", "text-transform", "letter-spacing",
  "display", "gap", "row-gap", "column-gap", "align-items", "justify-content", "justify-items",
  "flex-wrap", "flex-direction", "flex-grow",
  "grid-template-columns", "grid-template-rows",
  "width", "max-width", "min-width", "height", "min-height", "line-height", "white-space",
  "opacity", "vertical-align", "box-shadow",
]);
/** Back-compat name (cards). */
export const CARD_BODY_CSS = DIAGRAM_HTML_CSS;

/** Values may only contain these characters: no `&` (entity-encoded url()), no
 *  quotes, no `\`, no `;` (the declaration separator), no `!`, no `/` or `+`. */
const SAFE_CSS_VALUE = /^[A-Za-z0-9#.%,()\s-]+$/;
/** The only functions a value may call. None of them loads a resource. */
const SAFE_CSS_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "repeat", "minmax", "linear-gradient", "radial-gradient", "repeating-linear-gradient",
]);
/** Enumerated values for the properties that have a closed set. */
const CSS_ENUM: Record<string, ReadonlySet<string>> = {
  display: new Set(["block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "none"]),
  "flex-wrap": new Set(["wrap", "nowrap", "wrap-reverse"]),
  "flex-direction": new Set(["row", "row-reverse", "column", "column-reverse"]),
  "justify-items": new Set(["start", "end", "center", "stretch"]),
};

/** Keep only the allow-listed declarations with safe values. Returns "" if none survive. */
export function sanitizeCardStyle(css: string): string {
  const out: string[] = [];
  for (const decl of css.split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (!DIAGRAM_HTML_CSS.has(prop) || !value || value.length > 160) continue;
    if (!SAFE_CSS_VALUE.test(value)) continue;
    if ([...value.matchAll(/([a-zA-Z-]+)\s*\(/g)].some((m) => !SAFE_CSS_FUNCTIONS.has(m[1].toLowerCase()))) continue;
    const enm = CSS_ENUM[prop];
    if (enm && !enm.has(value.toLowerCase())) continue;
    out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

/** The sanitizer. Pure string → string; the output is safe for innerHTML. */
export function sanitizeDiagramHtml(html: string): string {
  let s = html ?? "";
  // Comments first (an unclosed comment swallows the rest, as the browser would).
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, "");
  // Drop dangerous elements with their content; an unclosed one drops to the end.
  for (const tag of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "i"), "");
  }
  // Tokenize: a well-formed tag (quoted attribute values may contain `>`), a bare
  // `<` (escaped), or a run of text (inert: it contains no `<`).
  const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|<|[^<]+/g;
  const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let out = "";
  for (const m of s.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok === "<") { out += "&lt;"; continue; }
    if (!tok.startsWith("<")) { out += tok; continue; }
    const name = m[2].toLowerCase();
    if (!DIAGRAM_HTML_TAGS.has(name)) continue; // dropped; its text (if any) is kept as text tokens
    if (m[1] === "/") { if (name !== "br" && name !== "hr") out += `</${name}>`; continue; }
    let style = "";
    for (const a of (m[3] ?? "").matchAll(ATTR)) {
      if (a[1].toLowerCase() !== "style") continue;
      style = sanitizeCardStyle(a[2] ?? a[3] ?? a[4] ?? "");
    }
    out += `<${name}${style ? ` style="${style}"` : ""}>`;
  }
  return out;
}

/** Back-compat name: cards call this. Same sanitizer. */
export const sanitizeCardBody = sanitizeDiagramHtml;

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Legacy card fields (summary / desc / chips / tags) → equivalent body HTML. Used on
 *  parse so an older architecture.md renders the same content; the output is
 *  written back as `body` only. Colours are the old card defaults. */
export function legacyCardBody(c: {
  summary?: string;
  desc?: string;
  chips?: Array<{ key?: string; value?: string; color?: string }>;
  tags?: Array<string | { text: string; color?: string }>;
}): string {
  const parts: string[] = [];
  if (c.summary?.trim()) parts.push(`<p style="font-weight:700;font-size:14px;color:#0F172A">${escapeHtml(c.summary)}</p>`);
  if (c.desc?.trim()) parts.push(`<p style="font-size:12.5px;color:#64748B">${escapeHtml(c.desc)}</p>`);
  for (const ch of c.chips ?? []) {
    const color = ch.color || "#E8731A";
    const key = ch.key ? `<b style="color:${color}">${escapeHtml(ch.key)}</b> ` : "";
    parts.push(`<div style="border:1px solid ${color};border-radius:6px;padding:3px 8px;font-size:11px;margin-bottom:4px">${key}<span style="color:#334155">${escapeHtml(ch.value ?? "")}</span></div>`);
  }
  const tags = (c.tags ?? []).map((t) => (typeof t === "string" ? { text: t } : t)).filter((t) => t.text);
  if (tags.length) {
    parts.push(tags.map((t) => {
      const color = t.color || "#475569";
      const border = t.color || "#CBD5E1";
      return `<span style="border:1px solid ${border};border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;color:${color}">${escapeHtml(t.text)}</span>`;
    }).join(" "));
  }
  return parts.join("");
}

/** The body HTML a card should draw: `body` when authored, else the legacy fields. */
export function cardBodySource(c: { body?: string; summary?: string; desc?: string; chips?: Array<{ key?: string; value?: string; color?: string }>; tags?: Array<string | { text: string; color?: string }> }): string {
  if (typeof c.body === "string") return c.body;
  return legacyCardBody(c);
}

// -- Pure parse of the SANITIZED body, for the height estimator --------------------

/** One node of a sanitized body: an element (`tag`, inline `style` map, `kids`) or a
 *  text run (`text`, entities still encoded — decode with `decodeBodyText`). */
export interface BodyNode {
  tag?: string;
  style: Record<string, string>;
  kids: BodyNode[];
  text?: string;
}

const VOID_TAGS = new Set(["br", "hr"]);

/** Parse a body (sanitized here) into a tree. Unclosed tags close at their parent's
 *  close (or the end); a stray close tag is ignored. Pure. */
export function parseDiagramHtml(html: string): BodyNode[] {
  const clean = sanitizeDiagramHtml(html ?? "");
  const root: BodyNode = { style: {}, kids: [] };
  const stack: BodyNode[] = [root];
  const TOKEN = /<(\/?)([a-z][a-z0-9]*)((?:\s+style="[^"]*")?)\s*(\/?)>|([^<]+)/gi;
  for (const m of clean.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.kids.push({ style: {}, kids: [], text: m[5] }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const style: Record<string, string> = {};
    const sm = /style="([^"]*)"/.exec(m[3] ?? "");
    if (sm) for (const d of sm[1].split(";")) {
      const at = d.indexOf(":");
      if (at > 0) style[d.slice(0, at).trim().toLowerCase()] = d.slice(at + 1).trim();
    }
    const node: BodyNode = { tag, style, kids: [] };
    top.kids.push(node);
    if (!VOID_TAGS.has(tag)) stack.push(node);
  }
  return root.kids;
}

/** Entity-decode a text run from the sanitized body (the sanitizer only emits `&lt;`). */
export function decodeBodyText(t: string): string {
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** Document-wide typography hints the estimator needs: bold text anywhere, the largest
 *  explicit font-size, and the default heading size (h1–h4 render larger than body). */
export function diagramHtmlMeta(html: string): { bold: boolean; maxFont: number; headingFont: number } {
  const clean = sanitizeDiagramHtml(html ?? "");
  const bold = /<(b|strong|h[1-4])\b|font-weight:\s*(700|800|900|bold)/.test(clean);
  const fonts = [...clean.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => parseFloat(m[1]));
  const maxFont = fonts.length ? Math.max(...fonts) : 0;
  const headingFont = /<h1\b/.test(clean) ? 18 : /<h2\b/.test(clean) ? 16 : /<h[34]\b/.test(clean) ? 14 : 0;
  return { bold, maxFont, headingFont };
}

/** The body's CSS px for a length value (`12px`, `12`), or undefined when not px. */
export function pxOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^(-?[\d.]+)(px)?$/.exec(v.trim());
  return m ? parseFloat(m[1]) : undefined;
}
