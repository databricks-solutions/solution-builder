import React, { useMemo, useState } from "react";
import {
  Building2,
  Lightbulb,
  Sparkles,
  Database,
  Wrench,
  LayoutGrid,
  Users,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProposalSection {
  key: string;
  title: string;
  body: string;
}

function parseProposal(md: string): {
  name: string;
  sections: ProposalSection[];
} {
  const titleMatch = md.match(/^# (?:Demo Proposal:\s*)?(.+)$/m);
  const name = titleMatch ? titleMatch[1].trim() : "Untitled Proposal";
  const parts = md.split(/^(?=## )/gm);
  const sections: ProposalSection[] = [];

  for (const part of parts) {
    const hdr = part.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim();
    const body = part.slice(hdr[0].length).trim();
    const key = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    sections.push({ key, title, body });
  }

  return { name, sections };
}

// ---------------------------------------------------------------------------
// Section categorization
// ---------------------------------------------------------------------------

type Category =
  | "background"
  | "solution"
  | "persona"
  | "wow"
  | "datasets"
  | "transforms"
  | "outputs"
  | "build"
  | "other";

function categorize(key: string): Category {
  if (
    key.includes("background") ||
    key.includes("overview") ||
    key.includes("industry") ||
    key.includes("problem") ||
    key.includes("context") ||
    key.includes("storyline")
  )
    return "background";
  if (key.includes("solution") || key.includes("proposed")) return "solution";
  if (key.includes("company") || key.includes("persona")) return "persona";
  if (key.includes("wow") || key.includes("moment")) return "wow";
  if (key.includes("dataset") || key.includes("data")) return "datasets";
  if (key.includes("transform") || key.includes("pipeline")) return "transforms";
  if (key.includes("output") || key.includes("deliverable")) return "outputs";
  if (key.includes("build") || key.includes("step")) return "build";
  return "other";
}

const CATEGORY_CONFIG: Record<
  Category,
  { icon: typeof Building2; color: string; bg: string; border: string; accent: string }
> = {
  background: {
    icon: Building2,
    color: "text-blue-400",
    bg: "bg-blue-500/[0.04]",
    border: "border-blue-500/15",
    accent: "bg-blue-500/10",
  },
  solution: {
    icon: Lightbulb,
    color: "text-emerald-400",
    bg: "bg-emerald-500/[0.04]",
    border: "border-emerald-500/15",
    accent: "bg-emerald-500/10",
  },
  persona: {
    icon: Users,
    color: "text-cyan-400",
    bg: "bg-cyan-500/[0.04]",
    border: "border-cyan-500/15",
    accent: "bg-cyan-500/10",
  },
  wow: {
    icon: Sparkles,
    color: "text-amber-400",
    bg: "bg-amber-500/[0.04]",
    border: "border-amber-500/15",
    accent: "bg-amber-500/10",
  },
  datasets: {
    icon: Database,
    color: "text-violet-400",
    bg: "bg-violet-500/[0.04]",
    border: "border-violet-500/15",
    accent: "bg-violet-500/10",
  },
  transforms: {
    icon: Building2,
    color: "text-orange-400",
    bg: "bg-orange-500/[0.04]",
    border: "border-orange-500/15",
    accent: "bg-orange-500/10",
  },
  outputs: {
    icon: LayoutGrid,
    color: "text-pink-400",
    bg: "bg-pink-500/[0.04]",
    border: "border-pink-500/15",
    accent: "bg-pink-500/10",
  },
  build: {
    icon: Wrench,
    color: "text-primary",
    bg: "bg-primary/[0.04]",
    border: "border-primary/15",
    accent: "bg-primary/10",
  },
  other: {
    icon: Building2,
    color: "text-muted-foreground",
    bg: "bg-muted/20",
    border: "border-border",
    accent: "bg-muted",
  },
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

interface DatasetRow {
  table: string;
  description: string;
  rows: string;
}

function parseDatasetTable(body: string): DatasetRow[] | null {
  const rows: DatasetRow[] = [];
  const lines = body.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (line.includes("|") && (line.toLowerCase().includes("table") || line.toLowerCase().includes("name"))) {
      inTable = true;
      continue;
    }
    if (inTable && line.match(/^\|[-\s|:]+\|$/)) continue;
    if (inTable && line.startsWith("|")) {
      const cells = line
        .split("|")
        .filter(Boolean)
        .map((c) => c.trim());
      if (cells.length >= 2) {
        rows.push({
          table: cells[0],
          description: cells[1] || "",
          rows: cells[2] || "",
        });
      }
    } else if (inTable && !line.startsWith("|")) {
      inTable = false;
    }
  }
  return rows.length > 0 ? rows : null;
}

interface BuildStepItem {
  number: number;
  text: string;
  skill?: string;
}

function parseBuildSteps(body: string): BuildStepItem[] | null {
  const steps: BuildStepItem[] = [];
  const matches = body.matchAll(/^(\d+)\.\s+(.+)$/gm);
  for (const m of matches) {
    const text = m[2].trim();
    const skillMatch = text.match(/`([a-z][\w-]+)`/);
    steps.push({
      number: parseInt(m[1]),
      text: text.replace(/`[a-z][\w-]+`/g, "").replace(/\s{2,}/g, " ").trim(),
      skill: skillMatch ? skillMatch[1] : undefined,
    });
  }
  return steps.length > 0 ? steps : null;
}

interface OutputItem {
  name: string;
  description: string;
}

function parseOutputs(body: string): OutputItem[] | null {
  const items: OutputItem[] = [];
  const subheaders = body.split(/^(?=### )/gm);
  for (const sub of subheaders) {
    const m = sub.match(/^### (.+)\n/);
    if (m) {
      items.push({ name: m[1].trim(), description: sub.slice(m[0].length).trim().split("\n")[0] });
    }
  }
  if (items.length === 0) {
    const bullets = [...body.matchAll(/^[-*]\s+\*\*(.+?)\*\*[:\s]*(.+)$/gm)];
    for (const b of bullets) {
      items.push({ name: b[1].trim(), description: b[2].trim() });
    }
  }
  if (items.length === 0) {
    const bullets = [...body.matchAll(/^[-*]\s+(.+)$/gm)];
    for (const b of bullets) {
      const parts = b[1].split(/[:\u2014\u2013\u2013]/, 2);
      items.push({ name: parts[0].trim().replace(/\*\*/g, ""), description: (parts[1] || "").trim() });
    }
  }
  return items.length > 0 ? items : null;
}


// ---------------------------------------------------------------------------
// Helper: extract a one-line summary from a body of text
// ---------------------------------------------------------------------------

function extractSummary(body: string, maxLen = 120): string {
  const firstLine = body.split("\n").find((l) => l.trim().length > 20);
  if (!firstLine) return body.slice(0, maxLen);
  const clean = firstLine.replace(/\*\*/g, "").replace(/`[^`]+`/g, "").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 3) + "..." : clean;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function CollapsibleProseBlock({
  body,
  config,
  title,
  defaultOpen = false,
}: {
  body: string;
  config: (typeof CATEGORY_CONFIG)[Category];
  title: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = config.icon;
  const summary = useMemo(() => extractSummary(body), [body]);

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden transition-all`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${config.accent}`}>
          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {!isOpen && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{summary}</p>
          )}
        </div>
        <span className="text-muted-foreground/50 shrink-0">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-0 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="pl-8">
            <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{body}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DatasetsBlock({ rows }: { rows: DatasetRow[] }) {
  const cfg = CATEGORY_CONFIG.datasets;
  const Icon = cfg.icon;
  return (
    <div className={`rounded-xl border ${cfg.border} overflow-hidden`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 ${cfg.bg} border-b ${cfg.border}`}>
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.accent}`}>
          <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
        </div>
        <h3 className="text-sm font-semibold">Datasets</h3>
        <Badge variant="secondary" className="text-[10px] ml-auto">{rows.length} tables</Badge>
      </div>
      <div className="grid grid-cols-[1fr_2fr_auto] text-xs">
        {rows.map((row, i) => (
          <div key={i} className="contents">
            <div className={`px-4 py-2 flex items-center border-b border-border/20 ${i % 2 === 0 ? "" : "bg-muted/[0.03]"}`}>
              <code className="font-medium text-foreground">{row.table}</code>
            </div>
            <div className={`px-3 py-2 text-muted-foreground border-b border-border/20 ${i % 2 === 0 ? "" : "bg-muted/[0.03]"}`}>
              {row.description}
            </div>
            <div className={`px-3 py-2 text-right border-b border-border/20 ${i % 2 === 0 ? "" : "bg-muted/[0.03]"}`}>
              <Badge variant="outline" className="text-[10px] font-mono border-violet-500/20 text-violet-400">
                {row.rows}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function OutputsBlock({ items }: { items: OutputItem[] }) {
  const cfg = CATEGORY_CONFIG.outputs;
  const Icon = cfg.icon;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.accent}`}>
          <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
        </div>
        <h3 className="text-sm font-semibold">Outputs</h3>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, i) => (
          <div
            key={i}
            className={`rounded-lg border ${cfg.border} ${cfg.bg} px-3 py-2.5`}
          >
            <p className="text-xs font-semibold text-foreground">{item.name}</p>
            {item.description && (
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildStepsBlock({ steps }: { steps: BuildStepItem[] }) {
  const cfg = CATEGORY_CONFIG.build;
  const Icon = cfg.icon;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.accent}`}>
          <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
        </div>
        <h3 className="text-sm font-semibold">Build Steps</h3>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex items-start gap-2.5 rounded-lg border border-primary/10 bg-primary/[0.02] px-3 py-2.5"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary mt-0.5">
              {step.number}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug">{step.text}</p>
              {step.skill && (
                <Badge variant="outline" className="mt-1 text-[10px] font-mono border-primary/20 text-primary/70">
                  {step.skill}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ProposalCards({
  markdown,
  streaming,
}: {
  markdown: string;
  streaming?: boolean;
}) {
  const { name, sections } = useMemo(() => parseProposal(markdown), [markdown]);

  if (sections.length === 0 && !streaming) return null;

  const categorized = sections.map((s) => ({ ...s, cat: categorize(s.key) }));

  const background = categorized.filter((s) => s.cat === "background");
  const solution = categorized.filter((s) => s.cat === "solution");
  const persona = categorized.filter((s) => s.cat === "persona");
  const wow = categorized.filter((s) => s.cat === "wow");
  const datasets = categorized.filter((s) => s.cat === "datasets");
  const outputs = categorized.filter((s) => s.cat === "outputs");
  const build = categorized.filter((s) => s.cat === "build");
  const other = categorized.filter((s) => s.cat === "other");

  const datasetRows = datasets.length > 0 ? parseDatasetTable(datasets[0].body) : null;
  const outputItems = outputs.length > 0 ? parseOutputs(outputs[0].body) : null;
  const buildSteps = build.length > 0 ? parseBuildSteps(build[0].body) : null;

  const blocks: React.ReactNode[] = [];

  blocks.push(
    <h2 key="title" className="text-lg font-bold tracking-tight">{name}</h2>,
  );

  // Narrative sections — collapsible to avoid overwhelming
  if (background.length > 0) {
    blocks.push(
      <div key="bg" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <CollapsibleProseBlock
          body={background.map((s) => s.body).join("\n\n")}
          config={CATEGORY_CONFIG.background}
          title="Background"
        />
      </div>,
    );
  }

  if (solution.length > 0) {
    blocks.push(
      <div key="sol" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <CollapsibleProseBlock
          body={solution[0].body}
          config={CATEGORY_CONFIG.solution}
          title={solution[0].title}
        />
      </div>,
    );
  }

  if (persona.length > 0 || wow.length > 0) {
    blocks.push(
      <div key="pw" className="grid gap-3 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {persona.map((s) => (
          <CollapsibleProseBlock key={s.key} body={s.body} config={CATEGORY_CONFIG.persona} title={s.title} />
        ))}
        {wow.map((s) => (
          <CollapsibleProseBlock key={s.key} body={s.body} config={CATEGORY_CONFIG.wow} title={s.title} />
        ))}
      </div>,
    );
  }

  // Visual/structured sections — always expanded, these are easy to scan
  if (datasetRows) {
    blocks.push(
      <div key="ds" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <DatasetsBlock rows={datasetRows} />
      </div>,
    );
  }

  if (outputItems) {
    blocks.push(
      <div key="out" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <OutputsBlock items={outputItems} />
      </div>,
    );
  }

  if (buildSteps) {
    blocks.push(
      <div key="bs" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <BuildStepsBlock steps={buildSteps} />
      </div>,
    );
  }

  for (const s of other) {
    blocks.push(
      <div key={s.key} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <CollapsibleProseBlock body={s.body} config={CATEGORY_CONFIG.other} title={s.title} />
      </div>,
    );
  }

  return (
    <div className="space-y-3">
      {blocks}
      {streaming && (
        <div className="flex items-center gap-2 py-2">
          <span className="inline-block h-4 w-1 animate-pulse bg-primary rounded-full" />
          <span className="text-xs text-muted-foreground animate-pulse">Generating...</span>
        </div>
      )}
    </div>
  );
}
