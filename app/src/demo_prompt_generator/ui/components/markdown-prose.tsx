import { useEffect, useRef, useId, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";

// Initialize mermaid once
let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    fontFamily: "inherit",
    securityLevel: "loose",
  });
}

// ---------------------------------------------------------------------------
// MermaidBlock — renders a fenced ```mermaid code block as an SVG
// ---------------------------------------------------------------------------

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const id = `mermaid-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (!containerRef.current || !code.trim()) return;
    ensureMermaidInit();

    let cancelled = false;
    (async () => {
      try {
        const { svg } = await mermaid.render(id, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre class="text-xs text-muted-foreground whitespace-pre-wrap p-3">${code}</pre>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto rounded-lg border border-border/40 bg-muted/20 p-4 [&_svg]:max-w-full"
    />
  );
}

// ---------------------------------------------------------------------------
// Prose — full markdown renderer with Mermaid, GFM tables, etc.
// ---------------------------------------------------------------------------

interface ProseProps {
  children: string;
  /** Additional class names on the wrapper */
  className?: string;
  /** Compact = tighter spacing for card interiors */
  compact?: boolean;
  /**
   * Visual tone. "default" uses themed foreground/muted/primary colors (for
   * assistant bubbles on muted bg). "onPrimary" forces text-inherit/current
   * for all elements so markdown renders legibly inside the primary-colored
   * user bubble.
   */
  tone?: "default" | "onPrimary";
}

export const Prose = memo(function Prose({
  children,
  className = "",
  compact = false,
  tone = "default",
}: ProseProps) {
  if (!children) return null;

  const base = compact
    ? "leading-relaxed"
    : "prose prose-base dark:prose-invert max-w-none";

  const onPrimary = tone === "onPrimary";
  const strongCls = onPrimary ? "font-semibold" : "font-semibold text-foreground";
  const emCls = onPrimary ? "italic" : "italic text-foreground/90";
  const inlineCodeCls = onPrimary
    ? "rounded bg-primary-foreground/15 px-1.5 py-0.5 text-sm font-mono"
    : "rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-primary/80";
  const preCls = onPrimary
    ? "overflow-x-auto rounded-lg bg-primary-foreground/10 p-3 text-sm leading-relaxed"
    : "overflow-x-auto rounded-lg bg-muted/60 p-3 text-sm leading-relaxed";
  const linkCls = onPrimary
    ? "underline decoration-current/40 hover:decoration-current/80 transition-colors"
    : "text-primary underline decoration-primary/30 hover:decoration-primary/60 transition-colors";
  const blockquoteCls = onPrimary
    ? "my-3 border-l-2 border-current/40 pl-3 italic opacity-90"
    : "my-3 border-l-2 border-primary/30 pl-3 italic text-muted-foreground";
  const h2Cls = onPrimary
    ? "text-lg font-bold mt-3 mb-1.5 border-b border-current/20 pb-1"
    : "text-lg font-bold mt-3 mb-1.5 border-b border-border/30 pb-1";
  const h4Cls = onPrimary
    ? "text-sm font-semibold mt-2 mb-1 opacity-80"
    : "text-sm font-semibold mt-2 mb-1 text-muted-foreground";
  const bulletCls = onPrimary ? "shrink-0 mt-0.5 opacity-60" : "shrink-0 mt-0.5 text-primary/40";
  const tableWrapCls = onPrimary
    ? "my-3 overflow-x-auto rounded-lg border border-current/25"
    : "my-3 overflow-x-auto rounded-lg border border-border/40";
  const theadCls = onPrimary
    ? "bg-primary-foreground/10 text-left"
    : "bg-muted/40 text-left";
  const thCls = onPrimary
    ? "px-3 py-2 font-semibold border-b border-current/20"
    : "px-3 py-2 font-semibold text-foreground border-b border-border/40";
  const tdCls = onPrimary
    ? "px-3 py-2 border-b border-current/15"
    : "px-3 py-2 text-foreground/80 border-b border-border/20";
  const hrCls = onPrimary ? "my-4 border-current/20" : "my-4 border-border/30";

  return (
    <div className={`${base} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Mermaid code blocks → custom renderer. Everything else falls
          // through to <code> / <pre> defaults.
          code({ className: codeClass, children: codeChildren }) {
            const text = String(codeChildren).replace(/\n$/, "");
            if (/language-mermaid/.exec(codeClass || "")) {
              return <MermaidBlock code={text} />;
            }
            // Legacy `glance` blocks live in older project READMEs. The
            // DemoOverviewCard replaces them now; suppress the raw markdown
            // so it doesn't render as a stray code block. New READMEs
            // don't author them.
            if (/language-glance/.exec(codeClass || "")) {
              return null;
            }
            // Inline code (no className = no language = inline)
            if (!codeClass) {
              return <code className={inlineCodeCls}>{codeChildren}</code>;
            }
            return <code className={codeClass}>{codeChildren}</code>;
          },
          // Override pre for code blocks. Mermaid blocks render their own
          // styled container from the `code` handler — bypass the pre wrapper
          // so we don't double-style or nest invalid block elements inside <pre>.
          pre({ children: preChildren }) {
            const childClass =
              (preChildren as { props?: { className?: string } } | null)?.props?.className ?? "";
            if (/language-mermaid|language-glance/.test(childClass)) {
              return <>{preChildren}</>;
            }
            return <pre className={preCls}>{preChildren}</pre>;
          },
          // Headings
          h1: ({ children: h }) => <h1 className="text-xl font-bold mt-4 mb-1.5">{h}</h1>,
          h2: ({ children: h }) => <h2 className={h2Cls}>{h}</h2>,
          h3: ({ children: h }) => <h3 className="text-base font-semibold mt-3 mb-1">{h}</h3>,
          h4: ({ children: h }) => <h4 className={h4Cls}>{h}</h4>,
          // Paragraphs
          p: ({ children: p }) => <p className="my-1 text-sm leading-relaxed">{p}</p>,
          // Lists
          ul: ({ children: u }) => <ul className="my-1.5 ml-1 space-y-0.5 list-none">{u}</ul>,
          ol: ({ children: o }) => <ol className="my-1.5 ml-1 space-y-0.5 list-none counter-reset-item">{o}</ol>,
          li: ({ children: l }) => (
            <li className="flex gap-1.5 text-sm leading-relaxed">
              <span className={bulletCls}>{"\u2022"}</span>
              <span className="flex-1">{l}</span>
            </li>
          ),
          // Tables
          table: ({ children: t }) => (
            <div className={tableWrapCls}>
              <table className="w-full text-sm">{t}</table>
            </div>
          ),
          thead: ({ children: th }) => <thead className={theadCls}>{th}</thead>,
          th: ({ children: thc }) => <th className={thCls}>{thc}</th>,
          td: ({ children: tdc }) => <td className={tdCls}>{tdc}</td>,
          // Blockquotes
          blockquote: ({ children: bq }) => (
            <blockquote className={blockquoteCls}>{bq}</blockquote>
          ),
          // Links
          a: ({ children: ac, href }) => (
            <a href={href} className={linkCls} target="_blank" rel="noopener noreferrer">
              {ac}
            </a>
          ),
          // Horizontal rule
          hr: () => <hr className={hrCls} />,
          // Strong / emphasis
          strong: ({ children: s }) => <strong className={strongCls}>{s}</strong>,
          em: ({ children: e }) => <em className={emCls}>{e}</em>,
          // Task list items (GFM)
          input: ({ checked }) => (
            <input
              type="checkbox"
              checked={checked}
              disabled
              className="mt-1 accent-primary"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
