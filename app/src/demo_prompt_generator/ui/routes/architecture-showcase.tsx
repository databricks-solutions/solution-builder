import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Maximize2, MessageSquareQuote, ScanSearch, Sparkles, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { ScanPromptDialog } from "@/components/scan-prompt-dialog";

// Architecture showcase: real prompts typed in the Architecture tab next to the
// diagram the agent drew from them, unedited. The data (prompt + architecture.md
// per example) lives in public/architecture-showcase.json; each diagram renders
// live through the same read-only canvas the template gallery uses.
export const Route = createFileRoute("/architecture-showcase")({
  component: () => <AppLayout><ArchitectureShowcase /></AppLayout>,
});

const PlatformDiagram = lazy(() => import("@/components/project/platform-diagram"));

interface ShowcaseItem {
  id: string;
  title: string;
  style: string;
  /** The prompt someone typed (agent examples) or the file's header (skill references). */
  prompt: string;
  renders?: number;
  seconds?: number;
  /** "reference": a skill reference diagram (public/architecture-references.json, generated
   *  from .claude/skills/databricks-architecture/reference by gen-showcase-references.mjs). */
  source?: "reference";
  file?: string;
  /** Set when the diagram was edited after the agent drew it: shown in place of the
   *  render count, so the "one prompt, no human edits" promise stays true. */
  note?: string;
  architecture: string;
}

const STYLE_LABEL: Record<string, string> = {
  marketing: "Marketing",
  technical: "Technical",
  lifecycle: "Lifecycle",
  networking: "Networking",
  match: "Match my image",
};

const STYLE_BADGE: Record<string, string> = {
  marketing: "bg-red-50 text-red-700",
  technical: "bg-blue-50 text-blue-700",
  lifecycle: "bg-emerald-50 text-emerald-700",
  networking: "bg-violet-50 text-violet-700",
  match: "bg-amber-50 text-amber-800",
};

type Source = "examples" | "references" | "all";
const SOURCES: { v: Source; label: string }[] = [
  { v: "examples", label: "Agent examples" },
  { v: "references", label: "Skill references" },
  { v: "all", label: "All" },
];

function ArchitectureShowcase() {
  const [items, setItems] = useState<ShowcaseItem[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<ShowcaseItem | null>(null);
  // ?source=references opens the skill's reference diagrams directly (for reviewing them).
  const [source, setSourceState] = useState<Source>(() => {
    const v = new URLSearchParams(window.location.search).get("source");
    return v === "references" || v === "all" ? v : "examples";
  });
  const setSource = (v: Source) => {
    setSourceState(v);
    setFilter("all");
    const u = new URL(window.location.href);
    if (v === "examples") u.searchParams.delete("source"); else u.searchParams.set("source", v);
    window.history.replaceState(null, "", u);
  };

  useEffect(() => {
    const load = (url: string) => fetch(url).then((r) => r.json()).then((d: { items: ShowcaseItem[] }) => d.items).catch(() => [] as ShowcaseItem[]);
    Promise.all([load("/architecture-showcase.json"), load("/architecture-references.json")])
      .then(([examples, refs]) => setItems([...examples, ...refs]));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const inSource = (items ?? []).filter((i) => source === "all" || (source === "references") === (i.source === "reference"));
  const count = (v: Source) => (items ?? []).filter((i) => v === "all" || (v === "references") === (i.source === "reference")).length;
  const styles = [...new Set(inSource.map((i) => i.style))];
  const shown = inSource.filter((i) => filter === "all" || i.style === filter);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header: same calm treatment as the Template Library. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Solution Builder draws more than you think</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Deck-ready slides, engineering detail, lifecycles, cloud networking. Each example is the exact prompt
            someone typed, next to the diagram the agent drew from it: one prompt, no human edits unless marked.
          </p>
        </div>
        <TryItButton />
      </div>

      <FromExistingProject />

      {/* Source (agent examples vs the skill's reference diagrams), then style. Same segmented
          control as the Templates status tabs. */}
      <div className="flex flex-wrap items-center gap-3">
      <div className="flex w-fit items-center gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Filter by source">
        {SOURCES.map(({ v, label }) => (
          <button key={v} type="button" role="tab" aria-selected={source === v} onClick={() => setSource(v)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${source === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {label} {items && <span className="tabular-nums text-xs opacity-60">{count(v)}</span>}
          </button>
        ))}
      </div>
      <div className="flex w-fit items-center gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Filter by style">
        {["all", ...styles].map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? "All styles" : STYLE_LABEL[s] ?? s}
          </button>
        ))}
      </div>
      </div>

      {items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-muted-foreground">The examples could not be loaded.</p>}

      {/* Two per row. */}
      <TooltipProvider delayDuration={150}>
        <div className="grid gap-6 xl:grid-cols-2">
          {shown.map((item) => (
            <article key={item.id} className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
              <header className="flex items-center gap-2.5 border-b px-4 py-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLE_BADGE[item.style] ?? "bg-muted text-muted-foreground"}`}>
                  {STYLE_LABEL[item.style] ?? item.style}
                </span>
                {item.source === "reference" && (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Reference</span>
                )}
                <h2 className="truncate text-sm font-semibold">{item.title}</h2>
                {/* The prompt on hover keeps the card for the diagram. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="ml-auto h-7 shrink-0 cursor-help gap-1.5 text-xs text-muted-foreground">
                      <MessageSquareQuote className="h-3.5 w-3.5" /> {item.source === "reference" ? "How it works" : "See the prompt"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className={`p-3 ${item.source === "reference" ? "max-h-[60vh] max-w-xl overflow-y-auto" : "max-w-md"}`}>
                    <p className={`whitespace-pre-wrap leading-relaxed ${item.source === "reference" ? "text-xs" : "text-sm"}`}>{item.prompt}</p>
                    <p className="mt-2 text-xs opacity-70">
                      {item.source === "reference"
                        ? `skill ${item.file}`
                        : item.note ?? `${item.renders} self-check render${(item.renders ?? 0) > 1 ? "s" : ""} · ${((item.seconds ?? 0) / 60).toFixed(1)} min`}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(item)}
                  className="h-7 w-7 shrink-0 cursor-pointer text-muted-foreground"
                  aria-label={`Open ${item.title} full screen`}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </header>
              <LazyDiagram item={item} />
            </article>
          ))}
        </div>
      </TooltipProvider>

      <div className="flex flex-col items-center gap-3 pt-6 text-center">
        <p className="text-sm text-muted-foreground">Describe yours, pick a style, and see what you get.</p>
        <TryItButton />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={open.title}>
          <div className="mb-3 flex items-center">
            <h2 className="text-lg font-semibold">{open.title}</h2>
            <Button variant="ghost" size="icon" autoFocus onClick={() => setOpen(null)} className="ml-auto cursor-pointer" aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden rounded-xl border bg-card">
            <Diagram item={open} />
          </div>
        </div>
      )}
    </div>
  );
}

function TryItButton() {
  return (
    <Button asChild className="gap-2">
      <a href="/?mode=architecture">
        <Sparkles className="h-4 w-4" /> Try it yourself
      </a>
    </Button>
  );
}

/** Mount the (heavy) canvas only once the card scrolls near the viewport. */
function LazyDiagram({ item }: { item: ShowcaseItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="h-[480px] bg-white">
      {visible && <Diagram item={item} />}
    </div>
  );
}

function Diagram({ item }: { item: ShowcaseItem }) {
  return (
    <Suspense fallback={<div className="h-full animate-pulse bg-muted/40" />}>
      <PlatformDiagram
        content={item.architecture}
        capabilities={null}
        projectId={`showcase-${item.id}`}
        defaultEditMode={false}
        readOnly
        hideChrome
        onSave={() => {}}
      />
    </Suspense>
  );
}

// "From an existing project": the diagram of something that already runs, reconstructed by the
// user's own agent (read-only, with the Databricks CLI) and drawn here. The dialog copies the prompt.
function FromExistingProject() {
  const [open, setOpen] = useState(false);
  const steps = [
    ["Copy the prompt", "Paste the URL of a pipeline, job, dashboard or app, and pick high level or every table."],
    ["Run it in your agent", "Claude Code, Cursor, any agent with the Databricks CLI and the Solution Builder MCP connected (the solution_builder tool). It explores the project read-only: lineage, jobs, dashboards, Genie, apps, Lakebase."],
    ["Get the diagram", "The agent creates it in Solution Builder through the MCP and gives you the link. Every node links to its real resource."],
  ];
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <ScanSearch className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Already built? Draw it from the workspace</h2>
            <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
              Point at a project that runs today and get its architecture as it really is, not as someone remembers it.
            </p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)} variant="outline" className="cursor-pointer gap-2">
          <Copy className="h-4 w-4" /> Get the prompt
        </Button>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3 rounded-lg bg-muted/40 p-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">{i + 1}</span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <ScanPromptDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
