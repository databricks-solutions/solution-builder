import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/app-layout";
import {
  BookOpen,
  Sparkles,
  Database,
  Layers,
  Lightbulb,
  ArrowRight,
  Puzzle,
  Shuffle,
  Bot,
  Download,
} from "lucide-react";

function DocsWithLayout() {
  return <AppLayout><DocsPage /></AppLayout>;
}

export const Route = createFileRoute("/docs")({
  component: DocsWithLayout,
});

function DocsPage() {
  return (
    <div className="p-6 lg:p-8 space-y-14 max-w-4xl">

      {/* -- Hero ---------------------------------------------------- */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">How It Works</h1>
            <p className="text-sm text-muted-foreground">
              Composable context blocks, assembled by AI into demo packages
            </p>
          </div>
        </div>

        <p className="text-base leading-relaxed text-muted-foreground">
          This app captures demo best practices as{" "}
          <span className="font-medium text-foreground">composable blocks</span> —
          domain knowledge, story patterns, and product guidance stored as Markdown files.
          An AI agent reads the relevant blocks and assembles them into a complete package:
          README, architecture diagram, and detailed instruction files that the{" "}
          <a href="https://github.com/databricks/ai-dev-kit" className="text-primary hover:underline" target="_blank" rel="noreferrer">
            AI Dev Kit
          </a>{" "}
          executes to build real Databricks resources.
        </p>
      </section>

      {/* -- Workflow as a horizontal pipeline ----------------------- */}
      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Workflow</h2>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            { num: "1", icon: Puzzle, title: "Describe", text: "Industry, scenario, products" },
            { num: "2", icon: Bot, title: "Design", text: "Story, README, architecture" },
            { num: "3", icon: Layers, title: "Specify", text: "Instruction files per component" },
            { num: "4", icon: Download, title: "Export", text: "Build on workspace or download ZIP" },
          ].map((step, idx) => (
            <div key={step.num} className="relative flex items-start gap-3 rounded-xl border bg-card p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold mt-0.5">
                {step.num}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.text}</p>
              </div>
              {idx < 3 && (
                <div className="hidden md:flex absolute -right-3.5 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/30">
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          The agent stops after writing the README for your approval. Instruction files
          are only generated once you confirm the story direction.
        </p>
      </section>

      {/* -- Context Blocks — mixed layout -------------------------- */}
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Context Blocks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Three types of blocks compose together. The agent follows cross-references
            in the frontmatter to navigate from domain to pattern to capabilities.
          </p>
        </div>

        {/* Domains — wide callout */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b bg-muted/30">
            <Database className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Domains</span>
            <Badge variant="outline" className="text-[10px] ml-auto">Context</Badge>
          </div>
          <div className="px-5 py-4 flex flex-col sm:flex-row gap-4">
            <p className="text-xs leading-relaxed text-muted-foreground flex-1">
              Industry verticals with terminology, KPIs and baselines, named personas,
              data entity schemas, and regulatory frameworks. Each domain declares{" "}
              <code className="text-[10px] bg-muted rounded px-1 py-0.5">suggested_patterns</code> and{" "}
              <code className="text-[10px] bg-muted rounded px-1 py-0.5">suggested_capabilities</code> so
              the agent knows which story structures and products fit.
            </p>
            <div className="flex flex-wrap gap-1.5 sm:flex-col sm:gap-1 shrink-0">
              {["retail", "healthcare", "financial-services", "manufacturing"].map((d) => (
                <span key={d} className="text-[10px] font-mono bg-muted rounded px-2 py-0.5 text-muted-foreground">{d}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Patterns + Capabilities — side by side */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Patterns</span>
              <Badge variant="outline" className="text-[10px] ml-auto">Story</Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Story structures — narrative arc, data shape, wow-moment design.
              Each pattern defines a different demo flow and lists which
              capabilities it needs.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["anomaly-detection", "customer-segmentation", "predictive-maintenance", "compliance-audit", "real-time-monitoring"].map((p) => (
                <span key={p} className="text-[10px] font-mono bg-muted rounded px-2 py-0.5 text-muted-foreground">{p}</span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Capabilities</span>
              <Badge variant="outline" className="text-[10px] ml-auto">Products</Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Product best practices — when to use each Databricks product,
              how to configure it for a demo, pitfalls, and how it connects
              to other products in the stack.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["aibi-dashboards", "genie", "sdp", "knowledge-assistant", "model-serving", "app-python"].map((c) => (
                <span key={c} className="text-[10px] font-mono bg-muted rounded px-2 py-0.5 text-muted-foreground">{c}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* -- Block anatomy — code block, no card wrapper ------------ */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Block Structure</h2>
        <p className="text-sm text-muted-foreground">
          YAML frontmatter for metadata, Markdown body for context. The agent parses
          the frontmatter to decide relevance, then reads the body for content.
        </p>
        <pre className="rounded-xl border bg-[var(--color-card)] p-5 text-xs leading-relaxed text-muted-foreground overflow-x-auto">
          <code>{`---
name: Anomaly Detection & Root Cause Investigation
slug: anomaly-detection
category: pattern
tags: [anomaly, investigation, root-cause, spike]
suggested_capabilities: [aibi-dashboards, genie-space, knowledge-assistant]
---

## Narrative Arc
1. **Normalcy** -- Baseline metric is stable and predictable
2. **Disruption** -- A spike appears in the KPI dashboard
3. **Investigation** -- Drill down with Genie, search docs with KA
4. **Discovery** -- Root cause identified, data + documents converge
5. **Resolution** -- Corrective action, impact quantified in $

## Wow Moment
The hero asks one natural-language question and the system traces
from aggregate metrics to a specific root cause in under 60 seconds.`}</code>
        </pre>
      </section>

      {/* -- Key concepts — compact table style --------------------- */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Glossary</h2>
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {[
                ["Block", "A Markdown file with YAML frontmatter — the atomic unit of reusable context. Three types: domains, patterns, capabilities."],
                ["Project", "A workspace with a chat session, generated files, and Databricks resource config. Produces README, architecture, and instruction files."],
                ["Template", "A published project snapshot. Fork it to start from a proven demo, then customize."],
                ["Instruction File", "A functional spec for one component — data schema, pipeline definition, dashboard layout, or Genie config. Detailed enough for the AI Dev Kit to execute."],
                ["Architecture", "A JSON schema describing the data flow as columns, nodes, and edges. The UI renders it as an interactive diagram."],
              ].map(([term, def]) => (
                <tr key={term}>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap align-top w-40">{term}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* -- Why blocks --------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Why Blocks?</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Traditional demo repos are rigid — one template per scenario, hard to customize,
          stale within weeks. Blocks decompose demos into reusable pieces that compose freely.
          Need a healthcare fraud demo? The agent reads the healthcare domain block, picks the
          anomaly-detection pattern, and pulls in the dashboard, Genie, and KA capability blocks.
          Need a manufacturing predictive maintenance demo instead? Same framework, different blocks,
          completely different output. Add a new industry by writing one Markdown file — no code changes.
        </p>
      </section>

      {/* -- Tips — inline, not card grid --------------------------- */}
      <section className="space-y-4 pb-8">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Tips</h2>
        </div>

        <dl className="space-y-3 text-sm">
          {[
            ["Be specific about your audience", "'Healthcare readmission demo for a CMO' beats 'healthcare demo'."],
            ["Let the agent pick the pattern", "Describe the scenario and it matches the right story structure."],
            ["Review the README first", "The agent pauses for approval before generating detailed specs."],
            ["Download anytime", "ZIP export works at every stage, not just when fully built."],
            ["Extend with new blocks", "Drop a Markdown file in blocks/ and the system picks it up."],
          ].map(([dt, dd]) => (
            <div key={dt} className="flex gap-2">
              <dt className="font-medium text-foreground whitespace-nowrap">{dt}.</dt>
              <dd className="text-muted-foreground">{dd}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
