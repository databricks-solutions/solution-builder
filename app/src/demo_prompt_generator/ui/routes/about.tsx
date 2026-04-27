import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Compass,
  Layers,
  Wrench,
  Database,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  Lightbulb,
  Repeat,
  Users,
  Building2,
  FileCode2,
  PackageOpen,
} from "lucide-react";

function AboutWithLayout() {
  return <AppLayout><AboutPage /></AppLayout>;
}

export const Route = createFileRoute("/about")({
  component: AboutWithLayout,
});

function AboutPage() {
  return (
    <div className="p-6 lg:p-8 space-y-16 max-w-5xl mx-auto">

      {/* -- Hero / Vision ------------------------------------------ */}
      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Compass className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">About</h1>
            <p className="text-sm text-muted-foreground">
              Why we built this — and where it fits in the Databricks tools landscape
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 lg:p-8">
          <p className="text-lg lg:text-xl font-medium leading-snug text-foreground">
            A demo is not a code asset. A demo is a <span className="text-primary">bundle of context</span> —
            an industry, a story, a set of products — that a capable agent can re-instantiate
            on demand.
          </p>
          <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
            We built this app because demos rot fast and rebuilding them by hand doesn't scale.
            If we capture the <em>context</em> behind a demo instead of the code, the same context
            can produce fresh, customer-tailored assets for the next account, the next vertical,
            the next product launch — without a maintenance burden that compounds.
          </p>
        </div>
      </section>

      {/* -- The Problem -------------------------------------------- */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="text-xl font-semibold tracking-tight">The problem with demo repos</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "They rot in weeks",
              body: "Product moves, APIs change, the platform gets new primitives. A repo that was crisp last quarter is half-broken by the next.",
            },
            {
              title: "They don't compose",
              body: "One repo per scenario. Need healthcare instead of retail? Fork, rewrite, re-test. The work doesn't carry over.",
            },
            {
              title: "Knowledge stays in heads",
              body: "The SA who built it knows the wow-moment, the gotchas, the why. Nothing in the repo captures that — just the artifacts.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border bg-card p-5 space-y-2">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -- The Shift ----------------------------------------------- */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">The shift: context, not code</h2>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          LLMs are good enough that the artifacts of a demo — pipelines, dashboards, Genie spaces,
          notebooks — are now <em>cheap to regenerate</em> if the model has the right context.
          That inverts the maintenance problem: stop maintaining the artifacts, start curating
          the context that produces them.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <FileCode2 className="h-4 w-4" />
              <span>Old model</span>
            </div>
            <p className="text-sm font-medium">Demo = code asset</p>
            <ul className="text-xs leading-relaxed text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>One repo per scenario, frozen the day it ships</li>
              <li>Maintenance scales with surface area</li>
              <li>Customization means a fork</li>
              <li>Tribal knowledge lives in commit history</li>
            </ul>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3 ring-1 ring-primary/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <PackageOpen className="h-4 w-4" />
              <span>New model</span>
            </div>
            <p className="text-sm font-medium">Demo = composable context</p>
            <ul className="text-xs leading-relaxed text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>Small Markdown blocks for industry, story, products</li>
              <li>Maintenance scales with concepts, not artifacts</li>
              <li>Customization is recombination, not a fork</li>
              <li>Tribal knowledge is checked-in and reusable</li>
            </ul>
          </div>
        </div>
      </section>

      {/* -- The Ecosystem ------------------------------------------- */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Where this fits</h2>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          This app is one layer of a stack. Each layer assumes the one below it and exposes
          the level of abstraction the next one up needs. The whole point is that you should
          rarely care about more than one layer at a time.
        </p>

        <div className="space-y-3">
          {[
            {
              tier: "Customer-facing demos",
              tool: "Industry Demo Prompts",
              role: "this app",
              icon: Sparkles,
              accent: true,
              body:
                "A curated library of demo context blocks plus an agent that composes them into a tailored package for a specific customer scenario. The output is a spec, not a binary — designed to be regenerated as the platform evolves.",
            },
            {
              tier: "Asset builder",
              tool: "AI Dev Kit",
              role: "executor",
              icon: Wrench,
              accent: false,
              body:
                "Takes the spec produced here and builds the actual Databricks resources — tables, pipelines, dashboards, Genie spaces, apps — on a live workspace. We hand it a description; it produces working assets.",
            },
            {
              tier: "SA workflow toolkit",
              tool: "Vibe (go/vibe)",
              role: "broader SA tooling",
              icon: Users,
              accent: false,
              body:
                "Day-to-day field-engineering automation: account research, RFP responses, escalations, training plans. Vibe is for the work around a customer engagement; this app is for the demo content within one.",
            },
            {
              tier: "Foundation",
              tool: "Databricks platform & docs",
              role: "primitives",
              icon: Database,
              accent: false,
              body:
                "Unity Catalog, Lakeflow, AI/BI, Genie, Agent Bricks, Apps, Lakebase. The substrate everything above produces against. The platform changes; context blocks let us keep up without rewriting demos.",
            },
          ].map((layer) => (
            <div
              key={layer.tool}
              className={`rounded-xl border bg-card p-5 flex gap-4 ${
                layer.accent ? "ring-1 ring-primary/40 bg-primary/5" : ""
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  layer.accent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                <layer.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {layer.tier}
                  </span>
                  <span className="text-sm font-semibold">{layer.tool}</span>
                  <span className="text-xs text-muted-foreground">— {layer.role}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{layer.body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          A reasonable mental model: <span className="font-medium text-foreground">Vibe</span> helps an
          SA run their week, <span className="font-medium text-foreground">this app</span> helps them
          design a demo, and the <span className="font-medium text-foreground">AI Dev Kit</span> turns
          that design into running infrastructure.
        </p>
      </section>

      {/* -- Two audiences ------------------------------------------ */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Built for two audiences</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Databricks Field Engineering</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              A growing library of vetted demo context — domains, story patterns, product
              capabilities — that any SA can draw on. Generate a tailored demo for a
              customer in minutes instead of cloning, customizing, and debugging a stale
              repo. Every accepted template makes the next demo cheaper to produce.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Customers</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The same framework — projects as composable context — works for capturing
              an organization's own use cases. Domain knowledge, KPIs, and product
              decisions become durable, regeneratable artifacts instead of slide decks
              and Confluence pages that drift out of date.
            </p>
          </div>
        </div>
      </section>

      {/* -- Flywheel ------------------------------------------------ */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Repeat className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Why this compounds</h2>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { step: "Build", text: "An SA designs a demo for a real customer scenario" },
              { step: "Capture", text: "The project's context — story, structure, products — is published as a template" },
              { step: "Reuse", text: "The next SA forks it, recombines it with new domain or product blocks" },
              { step: "Compound", text: "Each accepted demo enriches the library; the next one is cheaper" },
            ].map((s, i) => (
              <div key={s.step} className="relative flex gap-3 md:flex-col md:gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-bold">
                  {i + 1}
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{s.step}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
                {i < 3 && (
                  <div className="hidden md:flex absolute -right-2 top-1.5 text-muted-foreground/30">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed border-t pt-4">
            Traditional demo repos depreciate from the day they're shipped — every platform
            change is a tax. A context library appreciates: every accepted project is more
            material the next agent can pull from, and the maintenance surface stays roughly
            constant because the artifacts are regenerated, not edited.
          </p>
        </div>
      </section>

      {/* -- Closing footer note ------------------------------------ */}
      <section className="pb-8">
        <div className="rounded-xl border-2 border-dashed border-border/60 bg-muted/20 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">
            One sentence:
          </p>
          <p className="text-sm text-muted-foreground italic">
            Maintain the context, regenerate the code, share the library.
          </p>
        </div>
      </section>
    </div>
  );
}
