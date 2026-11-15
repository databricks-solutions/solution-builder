/**
 * platform-diagram/md-text — markdown for box / note / text annotations.
 *
 *  • <MdText>     renders an annotation's `text` as compact markdown sized to the
 *                 node (headings scale with the node's font size, no prose margins).
 *                 Plain text renders exactly as before: a single newline stays a
 *                 line break, so existing multi-line boxes are unchanged.
 *  • <MdTextarea> the raw-markdown editor. It registers itself (while mounted) as
 *                 the ACTIVE editor so the edit panel's Bold / Italic / Bullet /
 *                 Title buttons format its current selection (the buttons
 *                 preventDefault on mousedown, so the textarea keeps focus and its
 *                 selection). ⌘B / ⌘I work inside it too.
 *
 * Raw HTML is never rendered (react-markdown's default), and links render as
 * plain underlined text — a click on a diagram node selects it, it must not navigate.
 *
 * LOGOS: markdown image syntax names an ICON KEY, not a URL — `![OpenAI](file:vendor/openai)`
 * or `![MLflow](mlflowBrand)` — and renders that icon inline at text size (a card's
 * row of model logos). The caller supplies the icon renderer (`icon` prop), so this
 * module stays free of the icon registry. http(s) URLs are ignored: a node never
 * fetches an arbitrary image.
 */
import { createContext, memo, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { applyMdFormat, type MdFormat } from "./md-format";

export type { MdFormat } from "./md-format";

/** Renders an icon key (see LOGOS above). Provided per <MdText> via `icon`. */
export type MdIconRenderer = (iconKey: string) => ReactNode;
const MdIconContext = createContext<MdIconRenderer | null>(null);

function MdIcon({ src, alt }: { src?: string; alt?: string }) {
  const render = useContext(MdIconContext);
  if (!render || !src || /^(https?:)?\/\//i.test(src)) return null;
  return (
    <span
      title={alt || undefined}
      // Fixed HEIGHT, natural width: square marks stay square and a wordmark
      // (MLflow) keeps its aspect instead of shrinking into a square slot.
      style={{ display: "inline-flex", height: "1.7em", minWidth: "1.7em", margin: "0 0.25em", verticalAlign: "middle" }}
    >
      {render(src)}
    </span>
  );
}

/** How text inside blocks wraps: `pre-wrap` in a fixed box, `pre` for an
 *  auto-sized text label (it grows to fit instead of wrapping). */
type BlockWrap = "pre-wrap" | "pre";

function components(ws: BlockWrap): Components {
  // `white-space` goes on the BLOCKS, not the root: react-markdown puts "\n" text
  // between blocks, which a pre/pre-wrap root would render as blank lines. Inside
  // a block it keeps each soft line break — plain multi-line text looks unchanged.
  // No inline margins: Tailwind preflight zeroes them, and an inline margin would
  // override the .sb-md block spacing in globals.css.
  const block: CSSProperties = { whiteSpace: ws };
  const heading = (size: string): CSSProperties => ({ ...block, fontSize: size, fontWeight: 700, lineHeight: 1.25 });
  return {
    p: ({ children }) => <p style={block}>{children}</p>,
    h1: ({ children }) => <div style={heading("1.4em")}>{children}</div>,
    h2: ({ children }) => <div style={heading("1.2em")}>{children}</div>,
    h3: ({ children }) => <div style={heading("1.08em")}>{children}</div>,
    h4: ({ children }) => <div style={heading("1em")}>{children}</div>,
    h5: ({ children }) => <div style={heading("1em")}>{children}</div>,
    h6: ({ children }) => <div style={heading("1em")}>{children}</div>,
    ul: ({ children }) => <ul style={{ paddingLeft: "1.2em", listStyle: "disc" }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ paddingLeft: "1.5em", listStyle: "decimal" }}>{children}</ol>,
    li: ({ children }) => <li style={block}>{children}</li>,
    strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
    em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
    code: ({ children }) => (
      <code style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.9em", background: "rgba(127,127,127,0.14)", borderRadius: 3, padding: "0 0.25em" }}>
        {children}
      </code>
    ),
    pre: ({ children }) => <pre style={{ ...block, whiteSpace: "pre-wrap" }}>{children}</pre>,
    a: ({ children }) => <span style={{ textDecoration: "underline" }}>{children}</span>,
    hr: () => <hr style={{ margin: "0.4em 0", border: 0, borderTop: "1px solid currentColor", opacity: 0.25 }} />,
    blockquote: ({ children }) => <div style={{ borderLeft: "2px solid currentColor", paddingLeft: "0.5em", opacity: 0.8 }}>{children}</div>,
    img: ({ src, alt }) => <MdIcon src={typeof src === "string" ? src : undefined} alt={alt} />,
  };
}

const COMPONENTS: Record<BlockWrap, Components> = { "pre-wrap": components("pre-wrap"), pre: components("pre") };
const PLUGINS = [remarkGfm];
// Keep every URL verbatim: the default transform strips unknown protocols, which
// would erase `file:vendor/openai` icon keys. Safe here because links render as
// plain text and images only ever resolve through the icon renderer.
const keepUrl = (url: string) => url;

/** Blank line between blocks, matching what a blank line looked like as plain text. */
const ROOT_CLASS = "sb-md"; // block spacing: .sb-md in styles/globals.css

export const MdText = memo(function MdText({
  text,
  wrap = "pre-wrap",
  className,
  style,
  icon,
}: {
  text: string;
  wrap?: BlockWrap;
  className?: string;
  style?: CSSProperties;
  /** Resolves `![alt](iconKey)` logos. Without it, images render nothing. */
  icon?: MdIconRenderer;
}) {
  return (
    <div className={className ? `${ROOT_CLASS} ${className}` : ROOT_CLASS} style={{ whiteSpace: "normal", ...style }}>
      <MdIconContext.Provider value={icon ?? null}>
        <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS[wrap]} urlTransform={keepUrl}>
          {text}
        </ReactMarkdown>
      </MdIconContext.Provider>
    </div>
  );
});

// ─── The active editor (one at a time — only one textarea has focus) ──────────
interface MdEditorHandle { apply: (kind: MdFormat) => void }
let activeEditor: MdEditorHandle | null = null;

/** Format the focused annotation editor's selection. Returns false when no
 *  annotation is being edited, so the caller can format the whole text instead. */
export function applyToActiveMdEditor(kind: MdFormat): boolean {
  if (!activeEditor) return false;
  activeEditor.apply(kind);
  return true;
}

type MdTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (value: string) => void;
};

export function MdTextarea({ value, onValue, onFocus, onBlur, onKeyDown, ...rest }: MdTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Selection to restore once the formatted value has rendered.
  const pendingSel = useRef<[number, number] | null>(null);
  const handle = useRef<MdEditorHandle>({
    apply: (kind) => {
      const el = ref.current;
      if (!el) return;
      const r = applyMdFormat(el.value, el.selectionStart, el.selectionEnd, kind);
      pendingSel.current = [r.start, r.end];
      onValueRef.current(r.value);
    },
  });
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;

  useLayoutEffect(() => {
    const sel = pendingSel.current;
    const el = ref.current;
    if (!sel || !el) return;
    pendingSel.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  // Registered for its whole MOUNTED life, not on focus: the editor is always
  // autoFocus-ed, and React fires no onFocus for an element focused on mount, so a
  // focus-based registration never happened. One annotation edits at a time and
  // the textarea unmounts when the edit commits, so mount == editing.
  useLayoutEffect(() => {
    activeEditor = handle.current;
    return () => { if (activeEditor === handle.current) activeEditor = null; };
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      onFocus={(e) => { activeEditor = handle.current; onFocus?.(e); }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        if (mod && !e.shiftKey && !e.altKey && (key === "b" || key === "i")) {
          e.preventDefault();
          e.stopPropagation();
          handle.current.apply(key === "b" ? "bold" : "italic");
          return;
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}
