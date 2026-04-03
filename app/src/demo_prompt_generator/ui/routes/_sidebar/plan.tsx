import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Blocks,
  Layers,
  Sparkles,
  ArrowRight,
  ChevronRight,
  Globe,
  Workflow,
  Cpu,
  Package,
  Users,
  GitFork,
  Zap,
} from "lucide-react";
import { listBlocks, listCollections, type BlockSummary, type CollectionSummary } from "@/lib/custom-api";

export const Route = createFileRoute("/_sidebar/plan")({
  component: AboutPage,
});

// ---------------------------------------------------------------------------
// Block category styling
// ---------------------------------------------------------------------------

const CATEGORY_STYLE: Record<string, { bg: string; border: string; text: string; icon: typeof Globe; label: string; desc: string }> = {
  domain: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: Globe,
    label: "Domain",
    desc: "Industry knowledge — terminology, KPIs, personas, data entities, and regulatory context that make a demo feel authentic.",
  },
  pattern: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-400",
    icon: Workflow,
    label: "Pattern",
    desc: "Use-case archetypes — narrative arcs, data shapes, and investigation flows that work across industries.",
  },
  capability: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    icon: Cpu,
    label: "Capability",
    desc: "Databricks feature context — what the component does, when to use it, configuration decisions, and how it connects to other components.",
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AboutPage() {
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);

  useEffect(() => {
    listBlocks().then(setBlocks).catch(() => {});
    listCollections().then(setCollections).catch(() => {});
  }, []);

  const byCategory: Record<string, BlockSummary[]> = {};
  for (const b of blocks) {
    (byCategory[b.category] ??= []).push(b);
  }

  return (
    <div className="space-y-12 pb-12 max-w-4xl">
      {/* Hero */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <Blocks className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Structured Context Framework
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Blocks & Collections
            </h1>
          </div>
        </div>
        <p className="text-base text-muted-foreground leading-relaxed max-w-2xl">
          Demos aren't code — they're <strong className="text-foreground">structured context</strong>.
          Instead of writing scripts or maintaining repositories, you compose building blocks of
          knowledge that an AI agent assembles into a complete, working demo.
        </p>
      </div>

      <Separator className="opacity-30" />

      {/* The Idea */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">The idea</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
            <Blocks className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">Blocks are context</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A block is a piece of knowledge — about an industry, a use-case pattern,
              or a Databricks capability. It's not code. It's what an LLM needs to know
              to generate good build instructions.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
            <Layers className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">Collections are recipes</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A collection picks the right blocks for a demo and defines what gets
              generated. "Retail fraud detection" = retail domain + anomaly pattern +
              pipeline + dashboard + Genie + KA blocks.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
            <Zap className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">Generation is parallel</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Output files generate concurrently by dependency tier. The story comes first,
              then pipeline, dashboard, and agents generate in parallel — each getting
              only the context it needs.
            </p>
          </div>
        </div>
      </section>

      <Separator className="opacity-30" />

      {/* The Ontology */}
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Block types</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Three categories of structured context, each serving a different role in demo generation.
          </p>
        </div>

        {["domain", "pattern", "capability"].map((cat) => {
          const style = CATEGORY_STYLE[cat];
          const Icon = style.icon;
          const items = byCategory[cat] || [];

          return (
            <div key={cat} className={`rounded-xl border ${style.border} ${style.bg} p-5 space-y-3`}>
              <div className="flex items-start gap-3">
                <Icon className={`h-5 w-5 ${style.text} mt-0.5 shrink-0`} />
                <div>
                  <h3 className={`text-sm font-semibold ${style.text}`}>{style.label} Blocks</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{style.desc}</p>
                </div>
              </div>
              {items.length > 0 && (
                <div className="flex flex-wrap gap-1.5 ml-8">
                  {items.map((b) => (
                    <span
                      key={b.slug}
                      className={`rounded-lg ${style.bg} border ${style.border} px-2.5 py-1 text-[11px] font-medium ${style.text}`}
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <Separator className="opacity-30" />

      {/* How it flows */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">How it flows</h2>
        <div className="space-y-0">
          {[
            {
              step: "1",
              title: "Describe or pick",
              desc: "Type a use-case topic, or click an existing collection. If your topic matches a collection, we'll suggest it.",
              icon: Sparkles,
            },
            {
              step: "2",
              title: "See the blocks",
              desc: "The collection detail view shows exactly which context blocks power the demo — domain, pattern, and capabilities. Click any block to inspect its content.",
              icon: Blocks,
            },
            {
              step: "3",
              title: "Generate in parallel",
              desc: "Hit Generate. The story and data schema generate first (tier 0), then pipeline, dashboard, and agents generate concurrently (tier 1). Each file gets focused context from the blocks.",
              icon: Zap,
            },
            {
              step: "4",
              title: "Review and build",
              desc: "Multi-file package with a meta.md context router. The supervisor agent orchestrates workers — each gets one file and the shared context ledger.",
              icon: Package,
            },
          ].map((item, i, arr) => (
            <div key={item.step} className="flex gap-4">
              <div className="flex flex-col items-center w-8">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">
                  {item.step}
                </div>
                {i < arr.length - 1 && <div className="w-px flex-1 bg-border/50" />}
              </div>
              <div className="pb-6">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-lg">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Separator className="opacity-30" />

      {/* Contributing */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Contributing</h2>
        <p className="text-sm text-muted-foreground">
          The system grows when people add context. Here's how:
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Blocks className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Add a block</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Go to <Link to="/library" className="text-primary hover:underline">Library → Blocks</Link> and
              click <strong>New Block</strong>. Write the context an LLM would need to generate good
              build instructions for your domain, pattern, or capability.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold">Create a collection</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Go to <Link to="/library" className="text-primary hover:underline">Library → Collections</Link> and
              click <strong>New Collection</strong>. Pick the blocks that should power your demo
              type, give it a name, and save. Others can use it instantly.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-semibold">Fork and customize</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Don't start from scratch. Open an existing collection, adjust the blocks,
              and save it as your own. The agent fills any new gaps.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">It scales with the team</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every block and collection is shared. When someone adds healthcare context
              or a new capability block, every collection that uses it gets better.
              The more people contribute, the better the demos.
            </p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-5">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-primary">{blocks.length}</div>
            <div className="text-xs text-muted-foreground">Blocks</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">{collections.length}</div>
            <div className="text-xs text-muted-foreground">Collections</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">{byCategory["domain"]?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Industries</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">{byCategory["capability"]?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Capabilities</div>
          </div>
        </div>
      </div>
    </div>
  );
}
