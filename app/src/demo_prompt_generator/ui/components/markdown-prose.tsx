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
}

export const Prose = memo(function Prose({
  children,
  className = "",
  compact = false,
}: ProseProps) {
  if (!children) return null;

  const base = compact
    ? "prose-compact text-sm leading-relaxed"
    : "prose prose-sm dark:prose-invert max-w-none";

  return (
    <div className={`${base} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Mermaid code blocks
          code({ className: codeClass, children: codeChildren }) {
            const match = /language-mermaid/.exec(codeClass || "");
            const text = String(codeChildren).replace(/\n$/, "");
            if (match) {
              return <MermaidBlock code={text} />;
            }
            // Inline code (no className = no language = inline)
            if (!codeClass) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary/80">
                  {codeChildren}
                </code>
              );
            }
            return <code className={codeClass}>{codeChildren}</code>;
          },
          // Override pre for code blocks
          pre({ children: preChildren }) {
            return (
              <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
                {preChildren}
              </pre>
            );
          },
          // Headings
          h1: ({ children: h }) => <h1 className="text-base font-bold mt-4 mb-1.5">{h}</h1>,
          h2: ({ children: h }) => <h2 className="text-sm font-bold mt-3 mb-1.5 border-b border-border/30 pb-1">{h}</h2>,
          h3: ({ children: h }) => <h3 className="text-xs font-semibold mt-3 mb-1">{h}</h3>,
          h4: ({ children: h }) => <h4 className="text-xs font-semibold mt-2 mb-1 text-muted-foreground">{h}</h4>,
          // Paragraphs
          p: ({ children: p }) => <p className="my-1 text-xs leading-relaxed">{p}</p>,
          // Lists
          ul: ({ children: u }) => <ul className="my-1.5 ml-1 space-y-0.5 list-none">{u}</ul>,
          ol: ({ children: o }) => <ol className="my-1.5 ml-1 space-y-0.5 list-none counter-reset-item">{o}</ol>,
          li: ({ children: l }) => (
            <li className="flex gap-1.5 text-xs leading-relaxed">
              <span className="shrink-0 mt-0.5 text-primary/40">{"\u2022"}</span>
              <span className="flex-1">{l}</span>
            </li>
          ),
          // Tables
          table: ({ children: t }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-xs">{t}</table>
            </div>
          ),
          thead: ({ children: th }) => <thead className="bg-muted/40 text-left">{th}</thead>,
          th: ({ children: thc }) => <th className="px-3 py-2 font-semibold text-foreground border-b border-border/40">{thc}</th>,
          td: ({ children: tdc }) => <td className="px-3 py-2 text-foreground/80 border-b border-border/20">{tdc}</td>,
          // Blockquotes
          blockquote: ({ children: bq }) => (
            <blockquote className="my-3 border-l-2 border-primary/30 pl-3 italic text-muted-foreground">
              {bq}
            </blockquote>
          ),
          // Links
          a: ({ children: ac, href }) => (
            <a href={href} className="text-primary underline decoration-primary/30 hover:decoration-primary/60 transition-colors" target="_blank" rel="noopener noreferrer">
              {ac}
            </a>
          ),
          // Horizontal rule
          hr: () => <hr className="my-4 border-border/30" />,
          // Strong / emphasis
          strong: ({ children: s }) => <strong className="font-semibold text-foreground">{s}</strong>,
          em: ({ children: e }) => <em className="italic text-foreground/90">{e}</em>,
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
