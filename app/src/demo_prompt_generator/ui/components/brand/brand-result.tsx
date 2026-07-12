/**
 * BrandResult — a self-contained, centered view of a resolved company brand:
 * the logo candidates (each rendered on white / black / transparency-checker
 * backgrounds so light-text wordmarks like Databricks stay visible), the color
 * palette as copyable swatches, plus domain / confidence / warnings.
 *
 * Reusable: pass a `BrandOut` (from `resolveBrand`) — no fetching here. Used by
 * the standalone /brand test page today; drop-in elsewhere (project brand chip,
 * architecture logo picker) later.
 */
import { useState } from "react";
import type { BrandOut, BrandLogoCandidate, BrandTraceStep } from "@/lib/custom-api";
import { cn } from "@/lib/utils";
import { Check, Copy, ExternalLink, AlertTriangle, ChevronDown } from "lucide-react";

/** A tiny transparency-checkerboard via CSS gradients. */
const CHECKER =
  "repeating-conic-gradient(#d4d4d8 0% 25%, transparent 0% 50%) 50% / 16px 16px";

function LogoOnBackgrounds({ logo }: { logo: BrandLogoCandidate }) {
  const backgrounds: { key: string; label: string; style: React.CSSProperties }[] = [
    { key: "white", label: "white", style: { background: "#ffffff" } },
    { key: "black", label: "black", style: { background: "#000000" } },
    { key: "checker", label: "alpha", style: { background: CHECKER } },
  ];
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {logo.source}
          </span>
          {logo.chosen && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Check className="h-3 w-3" /> chosen
            </span>
          )}
        </div>
        {logo.url.startsWith("http") && (
          <a
            href={logo.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-primary"
            title={logo.url}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {backgrounds.map((bg) => (
          <div key={bg.key} className="flex flex-col items-center gap-1">
            <div
              className="flex h-20 w-full items-center justify-center overflow-hidden rounded-lg border"
              style={bg.style}
            >
              <img
                src={logo.data_url}
                alt={`${logo.source} logo on ${bg.label}`}
                className="max-h-16 max-w-[90%] object-contain"
              />
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {bg.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(hex).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="group flex flex-col items-center gap-1.5"
      title={`Copy ${hex}`}
    >
      <span
        className="relative flex h-16 w-16 items-center justify-center rounded-xl border shadow-sm"
        style={{ background: hex }}
      >
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          {copied ? (
            <Check className="h-4 w-4 text-white mix-blend-difference" />
          ) : (
            <Copy className="h-4 w-4 text-white mix-blend-difference" />
          )}
        </span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">{hex}</span>
    </button>
  );
}

/** A lightweight native <details> collapsible with a chevron. */
function Fold({ summary, children, defaultOpen = false }: {
  summary: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        {summary}
      </summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

const TRACE_COLOR: Record<string, string> = {
  tool: "text-blue-600",
  decision: "text-emerald-600",
  reasoning: "text-purple-600",
  warning: "text-red-600",
  phase: "text-slate-500",
};

function TraceView({ trace }: { trace: BrandTraceStep[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <tbody>
        {trace.map((s, i) => {
          const parts: string[] = [];
          if (s.args) parts.push(`args=${JSON.stringify(s.args)}`);
          if (s.summary) parts.push(`→ ${JSON.stringify(s.summary)}`);
          if (s.detail) parts.push(s.detail);
          return (
            <tr key={i} className="align-top">
              <td className="whitespace-nowrap pr-2 text-muted-foreground/60">{s.t_ms ?? ""}ms</td>
              <td className={cn("whitespace-nowrap pr-2 font-semibold", TRACE_COLOR[s.kind] ?? "")}>
                {s.tool || s.kind}
              </td>
              <td className="break-all font-mono text-muted-foreground">
                {parts.join(" ")}
                {s.reasoning && <div className="mt-0.5 italic text-purple-600/90">why: {s.reasoning}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BrandResult({ brand, className }: { brand: BrandOut; className?: string }) {
  const confPct = Math.round(brand.confidence * 100);
  const confColor =
    brand.confidence >= 0.75
      ? "text-emerald-600"
      : brand.confidence >= 0.4
        ? "text-amber-600"
        : "text-muted-foreground";

  return (
    <div className={cn("w-full space-y-6", className)}>
      {/* Header: name / domain / confidence */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{brand.name}</h2>
        <div className="mt-1 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          {brand.domain ? (
            <a
              href={`https://${brand.domain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-primary"
            >
              {brand.domain}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="italic">no domain resolved</span>
          )}
          <span className={cn("font-medium", confColor)}>{confPct}% confidence</span>
        </div>
      </div>

      {/* Palette (vertical, left) + website screenshot (right) */}
      {brand.site_screenshot ? (
        <section className="flex items-start justify-center gap-5">
          <div className="flex flex-col items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Palette
            </h3>
            {brand.palette.length > 0 ? (
              brand.palette.map((hex) => <Swatch key={hex} hex={hex} />)
            ) : (
              <p className="text-xs text-muted-foreground">none</p>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Website
            </h3>
            <div className="overflow-hidden rounded-xl border shadow-sm">
              <img src={brand.site_screenshot} alt={`${brand.name} homepage`} className="w-full" />
            </div>
          </div>
        </section>
      ) : (
        <section>
          <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Palette
          </h3>
          {brand.palette.length > 0 ? (
            <div className="flex flex-wrap items-start justify-center gap-4">
              {brand.palette.map((hex) => (
                <Swatch key={hex} hex={hex} />
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">No colors extracted.</p>
          )}
        </section>
      )}

      {/* Logos */}
      <section>
        <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {brand.logos.length > 0
            ? `Logo candidates (${brand.logos.length})`
            : "Logos"}
        </h3>
        {brand.logos.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {brand.logos.map((logo) => (
              <LogoOnBackgrounds key={logo.url} logo={logo} />
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">No logo found.</p>
        )}
      </section>

      {/* Warnings */}
      {brand.warnings.length > 0 && (
        <section className="mx-auto max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-700/90 dark:text-amber-400/90">
            {brand.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {/* See reasoning / all the steps — collapsed by default (results-first) */}
      {(brand.logo_contact_sheet || brand.trace?.length) && (
        <section className="mx-auto max-w-2xl space-y-3">
          <h3 className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            See reasoning
          </h3>

          {brand.logo_contact_sheet && (
            <Fold summary={`Logo candidates the model graded${brand.logo_provenance?.length ? ` (${brand.logo_provenance.length})` : ""}`}>
              <img
                src={brand.logo_contact_sheet}
                alt="logo grading grid"
                className="w-full rounded-md border"
              />
              {brand.logo_provenance && brand.logo_provenance.length > 0 && (
                <table className="mt-2 w-full border-collapse text-xs">
                  <tbody>
                    {brand.logo_provenance.map((p) => {
                      const vc =
                        p.verdict === "chosen"
                          ? "text-emerald-600"
                          : p.verdict === "alternate"
                            ? "text-blue-600"
                            : p.verdict === "rejected"
                              ? "text-red-600"
                              : "text-muted-foreground";
                      return (
                        <tr key={p.n} className="align-top">
                          <td className="pr-2">#{p.n}</td>
                          <td className={cn("pr-2 font-semibold", vc)}>{p.verdict}</td>
                          <td className="pr-2">{p.type}</td>
                          <td className="pr-2 font-mono text-muted-foreground">{p.host}</td>
                          <td>
                            {p.image?.startsWith("http") && (
                              <a href={p.image} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                src
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Fold>
          )}

          {brand.trace && brand.trace.length > 0 && (
            <Fold summary={`Full trace (${brand.trace.length} steps)`}>
              <TraceView trace={brand.trace} />
            </Fold>
          )}
        </section>
      )}
    </div>
  );
}

export default BrandResult;
