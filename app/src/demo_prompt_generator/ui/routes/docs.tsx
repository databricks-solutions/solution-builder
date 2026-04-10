import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/app-layout";
import {
  BookOpen,
  Sparkles,
  Database,
  GitBranch,
  BarChart3,
  Bot,
  FileText,
  Rocket,
  Layers,
  Users,
  Lightbulb,
  ArrowRight,
} from "lucide-react";

function DocsWithLayout() {
  return <AppLayout><DocsPage /></AppLayout>;
}

export const Route = createFileRoute("/docs")({
  component: DocsWithLayout,
});

/* ------------------------------------------------------------------ */
/*  Asset type cards for "What Gets Generated"                        */
/* ------------------------------------------------------------------ */
const assetTypes = [
  {
    icon: Database,
    title: "Datasets",
    description:
      "Synthetic data tailored to your industry and use case, ready to load into Unity Catalog.",
    badge: "Data",
  },
  {
    icon: GitBranch,
    title: "Pipelines",
    description:
      "End-to-end ingestion (Lakeflow Connect, Auto Loader) and processing (Spark Declarative Pipelines).",
    badge: "ETL",
  },
  {
    icon: BarChart3,
    title: "Dashboards",
    description:
      "SQL analytics queries and AI/BI dashboard definitions for immediate visual impact.",
    badge: "Analytics",
  },
  {
    icon: Bot,
    title: "AI Components",
    description:
      "Knowledge Assistants, Genie Spaces, and Supervisor Agents configured for your scenario.",
    badge: "AI / ML",
  },
  {
    icon: FileText,
    title: "Architecture",
    description:
      "Architecture diagrams and technical documentation that explain how every piece fits together.",
    badge: "Docs",
  },
  {
    icon: Rocket,
    title: "Build Steps",
    description:
      "A step-by-step deployment guide so anyone on the team can stand up the demo in a live workspace.",
    badge: "Deploy",
  },
];

/* ------------------------------------------------------------------ */
/*  Key concepts                                                      */
/* ------------------------------------------------------------------ */
const keyConcepts = [
  {
    icon: Layers,
    title: "Projects",
    description:
      "Self-contained demo packages that bundle every generated asset — data, pipelines, dashboards, AI components, and build instructions — into a single deliverable.",
  },
  {
    icon: Users,
    title: "Templates",
    description:
      "Reusable starting points shared across the team. Save a proven demo structure as a template so colleagues can spin up similar engagements in seconds.",
  },
  {
    icon: Sparkles,
    title: "Capabilities",
    description:
      "The Databricks products and features that can be composed into a demo — Lakeflow Connect, SDP, Genie, Knowledge Assistants, and more. Select only what matters for your story.",
  },
  {
    icon: Bot,
    title: "AI Architect",
    description:
      "The Claude-powered agent that orchestrates the entire generation pipeline. It understands how to compose Databricks products together for any vertical or use case.",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-16">
      {/* ── Hero / Overview ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <Badge variant="secondary" className="text-xs">
            Documentation
          </Badge>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">
          What is the Asset Generator?
        </h1>

        <p className="text-base leading-relaxed text-muted-foreground max-w-3xl">
          The Databricks Asset Generator helps field engineers and solution
          architects rapidly create complete demo packages for customer
          engagements. Describe a use case in plain language, and an AI architect
          agent produces datasets, pipelines, dashboards, AI components,
          architecture diagrams, and step-by-step build instructions — all
          tailored to the industry and scenario you specify.
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground/80 max-w-3xl">
          At its core this is a{" "}
          <span className="font-medium text-foreground">
            general framework for encapsulating context to build demos
          </span>
          . It captures industry knowledge, Databricks product capabilities, and
          best practices into a structured generation pipeline so any vertical
          can be addressed quickly and consistently.
        </p>
      </section>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">How It Works</h2>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Step 1 */}
          <div className="relative rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                1
              </span>
              <h3 className="font-medium">Describe your use case</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter a plain-language description of the demo you need — industry,
              scenario, customer context, and which Databricks capabilities to
              showcase.
            </p>
            {/* Connector arrow (visible on md+) */}
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
              <h3 className="font-medium">AI architect generates the package</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The Claude-powered agent composes the right Databricks products,
              generates synthetic data, writes pipeline code, and produces a
              complete demo blueprint.
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
              <h3 className="font-medium">Review, customize, and deploy</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Walk through every generated asset, refine what you need, and
              follow the build steps to deploy the demo into a live Databricks
              workspace.
            </p>
          </div>
        </div>
      </section>

      {/* ── What Gets Generated ─────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">
          What Gets Generated
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every demo package can include the following asset types. Select only
          the capabilities you need — the AI architect will tailor the output
          accordingly.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assetTypes.map((asset) => (
            <Card key={asset.title} className="relative overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <asset.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {asset.badge}
                  </Badge>
                </div>
                <CardTitle className="text-sm font-semibold mt-2">
                  {asset.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {asset.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Key Concepts ────────────────────────────────────────── */}
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

      {/* ── Quick Tips ──────────────────────────────────────────── */}
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
                Paste customer context
              </span>{" "}
              — include industry details, tech stack, and pain points for a demo
              that speaks directly to their world.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Start from a template
              </span>{" "}
              — browse the Template Gallery for proven starting points that
              accelerate generation.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Select only relevant capabilities
              </span>{" "}
              — fewer, focused capabilities produce tighter, more compelling
              demos.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>
              <span className="font-medium text-foreground">
                Review before deploying
              </span>{" "}
              — always walk through generated assets and customize them to match
              your narrative before standing up the demo.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
