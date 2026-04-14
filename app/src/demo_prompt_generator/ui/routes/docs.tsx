import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/app-layout";
import {
  BookOpen,
  Sparkles,
  Database,
  GitBranch,
  Layers,
  Lightbulb,
  ArrowRight,
  Puzzle,
  FolderTree,
  Shuffle,
  Eye,
  Blocks,
  Network,
} from "lucide-react";

function DocsWithLayout() {
  return <AppLayout><DocsPage /></AppLayout>;
}

export const Route = createFileRoute("/docs")({
  component: DocsWithLayout,
});

/* ------------------------------------------------------------------ */
/*  Block type cards for "The Building Blocks"                        */
/* ------------------------------------------------------------------ */
const blockTypes = [
  {
    icon: Database,
    title: "Domains",
    description:
      "Industry verticals like retail, healthcare, financial services, and manufacturing. Each block captures terminology, KPIs, personas, data entities, and common pain points.",
    badge: "Context",
    examples: "retail, healthcare, financial-services",
  },
  {
    icon: Sparkles,
    title: "Capabilities",
    description:
      "Platform features and tools that can be composed into a solution — pipelines, dashboards, model serving, vector search, and more. Each block describes when to use a capability and how it connects to others.",
    badge: "Tools",
    examples: "declarative-pipeline, aibi-dashboards, genie-space",
  },
  {
    icon: Shuffle,
    title: "Patterns",
    description:
      "Reusable analytical patterns that apply across industries — anomaly detection, customer segmentation, predictive maintenance. Each block defines a narrative arc, data shape, and the moment that makes the output compelling.",
    badge: "Strategy",
    examples: "customer-segmentation, anomaly-detection, compliance-audit",
  },
];

/* ------------------------------------------------------------------ */
/*  Key concepts                                                      */
/* ------------------------------------------------------------------ */
const keyConcepts = [
  {
    icon: Blocks,
    title: "Blocks",
    description:
      "The atomic unit of context. Each block is a Markdown file with YAML frontmatter — human-readable, version-controllable, and composable. Blocks declare relationships and tags so the system knows how they connect.",
  },
  {
    icon: FolderTree,
    title: "Collections",
    description:
      "Curated groups of blocks plus an output file dependency graph (DAG). A collection defines which blocks to assemble and what order to generate output files, ensuring each file can reference what came before it.",
  },
  {
    icon: Layers,
    title: "Projects",
    description:
      "A workspace where blocks and collections come together. Each project has a chat session with an AI agent that assembles context blocks into tailored output files, which you can review, edit, and iterate on.",
  },
  {
    icon: Network,
    title: "Templates",
    description:
      "Published project snapshots that capture a proven block combination and output structure. Anyone can fork a template to get a head start, then customize it for their specific scenario.",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
function DocsPage() {
  return (
    <div className="p-6 lg:p-8 space-y-10">
      {/* -- Hero / Overview ---------------------------------------- */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Documentation</h1>
            <p className="text-sm text-muted-foreground">
              How Asset Builder works and how to use it
            </p>
          </div>
        </div>

        <p className="text-base leading-relaxed text-muted-foreground max-w-prose">
          This application is a context management framework built on a simple
          idea: <span className="font-medium text-foreground">prompts are
          easier to work with than project configurations</span>. Instead of
          maintaining complex templates, code scaffolds, or static
          repositories, you capture best practices and domain knowledge as
          composable blocks of structured context — plain Markdown files with
          YAML frontmatter. An LLM reads these blocks and assembles them into
          tailored output packages for any scenario.
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground/80 max-w-prose">
          The underlying pattern is generalizable: define context as blocks,
          group blocks into collections, and let an AI agent assemble them into
          coherent output. The current deployment targets Databricks demos, but
          the framework applies wherever you need to combine domain knowledge,
          tool capabilities, and analytical patterns into structured
          deliverables.
        </p>
      </section>

      {/* -- Why Prompts-as-Config ---------------------------------- */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Why Prompts Instead of Config Files?
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex gap-4 rounded-xl border bg-card p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Eye className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Human-readable</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Blocks are Markdown. Anyone can read, understand, and
                contribute to them without learning a framework or config
                language.
              </p>
            </div>
          </div>

          <div className="flex gap-4 rounded-xl border bg-card p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Puzzle className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Composable</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Blocks are designed to be mixed and matched. Combine a domain,
                a pattern, and a set of capabilities — the LLM handles the
                integration.
              </p>
            </div>
          </div>

          <div className="flex gap-4 rounded-xl border bg-card p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Generalizable</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The pattern — blocks of context, LLM assembly, structured
                output — is not specific to any one tool or industry. Add new
                blocks to cover new domains.
              </p>
            </div>
          </div>

          <div className="flex gap-4 rounded-xl border bg-card p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GitBranch className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Version-controlled</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Blocks are files. They live in git, support pull requests, diffs,
                and branching — your context library evolves with standard
                workflows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -- How It Works ------------------------------------------- */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">How It Works</h2>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Step 1 */}
          <div className="relative rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                1
              </span>
              <h3 className="font-medium">Select your context</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Choose a collection or pick individual blocks — a domain for
              industry context, capabilities for the tools you want, and a
              pattern for the analytical approach.
            </p>
            <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/40">
              <ArrowRight className="h-5 w-5" />
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                2
              </span>
              <h3 className="font-medium">AI assembles the output</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The agent reads your selected blocks, resolves the output DAG
              from the collection, and generates each file in dependency order
              — so every file can reference what came before it.
            </p>
            <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/40">
              <ArrowRight className="h-5 w-5" />
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                3
              </span>
              <h3 className="font-medium">Review and iterate</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Walk through the generated files, refine through conversation
              with the agent, and export the package. Use it directly or
              publish it as a template for others to fork.
            </p>
          </div>
        </div>
      </section>

      {/* -- The Building Blocks ------------------------------------ */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">
          The Building Blocks
        </h2>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every block is a Markdown file with YAML frontmatter that declares
          its name, category, tags, and relationships. The three block
          categories cover different dimensions of context.
        </p>

        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
          {blockTypes.map((block) => (
            <Card key={block.title} className="relative overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <block.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {block.badge}
                  </Badge>
                </div>
                <CardTitle className="text-sm font-semibold mt-2">
                  {block.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {block.description}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/70">
                  {block.examples}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* -- Block anatomy ------------------------------------------ */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Anatomy of a Block
        </h2>
        <p className="text-sm text-muted-foreground max-w-prose">
          Blocks follow a consistent structure. The YAML frontmatter provides
          machine-readable metadata, while the Markdown body contains the
          context that gets fed to the LLM during assembly.
        </p>
        <div className="rounded-xl border bg-card p-5">
          <pre className="text-xs leading-relaxed text-muted-foreground overflow-x-auto">
            <code>{`---
name: Customer Segmentation & Predictive Targeting
slug: customer-segmentation
category: pattern
tags: [segmentation, clustering, personalization, scoring]
description: >
  Segment entities by behavior or attributes, deploy prediction
  models, and serve insights through interactive applications.
suggested_capabilities: [aibi-dashboards, genie-space, declarative-pipeline]
---

## Narrative Arc
1. **Flat world** -- The organization treats all entities uniformly...
2. **Segmentation reveal** -- Analysis exposes distinct behavioral clusters...
3. **Prediction layer** -- A model scores each entity for likelihood...
4. **Activation** -- Segments and scores are surfaced through dashboards...

## Data Shape
| Layer          | Abstract Entity     | Role                        |
|----------------|--------------------|-----------------------------|
| Fact table     | Interactions       | Behavioral signals over time|
| Dimension      | Entities           | The subjects being segmented|
| Feature store  | Engineered features| Aggregated behavioral metrics|
...`}</code>
          </pre>
        </div>
      </section>

      {/* -- Key Concepts ------------------------------------------- */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">Key Concepts</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {keyConcepts.map((concept) => (
            <div
              key={concept.title}
              className="flex gap-4 rounded-xl border bg-card p-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <concept.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{concept.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {concept.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -- Quick Tips --------------------------------------------- */}
      <section className="space-y-4 pb-8">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Quick Tips</h2>
        </div>

        <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed pl-1">
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Start with a collection
              </span>{" "}
              — collections are pre-curated block combinations with a tested
              output DAG. They are the fastest path to a complete package.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Write your own blocks
              </span>{" "}
              — if the built-in blocks do not cover your domain or toolset,
              add a new Markdown file. The YAML frontmatter schema is
              lightweight and the system picks up new blocks automatically.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Fewer blocks, tighter output
              </span>{" "}
              — selecting only the blocks relevant to your scenario produces
              more focused and coherent results than loading everything at
              once.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Iterate with the agent
              </span>{" "}
              — generation is a starting point. Use the chat interface to
              refine files, adjust the narrative, or add detail. The agent
              retains full context of what was generated and why.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Publish templates for reuse
              </span>{" "}
              — when you have a project that works well, publish it as a
              template. Others can fork it and adapt the output without
              rebuilding from scratch.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
