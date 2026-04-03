import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/apx/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import {
  Sparkles,
  History,
  ArrowRight,
  Search,
  Lightbulb,
  Library,
  Layers,
  Blocks,
} from "lucide-react";
import {
  listCollections,
  type CollectionSummary,
} from "@/lib/custom-api";

export const Route = createFileRoute("/")({
  component: Index,
});


function Index() {
  const [topic, setTopic] = useState("");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listCollections()
      .then(setCollections)
      .catch(() => {});
  }, []);

  const handleGo = (text?: string) => {
    const val = (text || topic).trim();
    if (!val) return;
    navigate({ to: "/workspace", search: { topic: val, generationId: undefined, collection: "" } });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center px-4 pt-12 pb-20">
        <BubbleBackground
          interactive
          className="!absolute inset-0 -z-10 opacity-30"
          colors={{
            first: "255,54,33",
            second: "255,120,80",
            third: "255,85,50",
            fourth: "200,40,25",
            fifth: "255,160,100",
            sixth: "255,100,60",
          }}
        />

        {/* Hero */}
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm border border-primary/20">
              <img src="/logo.svg" alt="Databricks" className="h-10 w-10" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                Use-Case Generator
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-base text-muted-foreground leading-relaxed">
              Describe a use-case and the AI architect builds a complete demo
              package with datasets, pipelines, dashboards, and build steps.
            </p>
          </div>

          {/* Input card */}
          <Card className="mx-auto w-full max-w-2xl text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleGo();
                }}
                className="space-y-2.5"
              >
                <Input
                  placeholder='Describe a use-case... e.g. "predictive maintenance for wind turbines"'
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-12 text-base bg-background/60"
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground px-0"
                    asChild
                  >
                    <Link to="/generations" className="gap-1.5">
                      <History className="h-3.5 w-3.5" /> Past generations
                    </Link>
                  </Button>
                  <Button
                    type="submit"
                    disabled={!topic.trim()}
                    className="gap-2 px-5"
                  >
                    <Sparkles className="h-4 w-4" /> Build Skill
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Research agent callout */}
          <div className="mx-auto max-w-2xl">
            <div className="rounded-xl border border-primary/10 bg-primary/[0.03] backdrop-blur-sm px-4 py-3 text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Search className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Tailoring for a specific customer?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    Before building a demo skill, ask a research agent (Claude,
                    Genie, Glean) to summarize the customer's industry, current
                    tech stack, pain points, and Databricks usage. Paste that
                    context into the input above for a proposal that speaks
                    directly to their world.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 ml-11 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-primary/60" />
                  <span className="font-medium text-foreground/70">
                    Example prompt:
                  </span>
                </span>
                <button
                  onClick={() =>
                    setTopic(
                      "Build a demo for Acme Corp (Fortune 500 retailer, heavy on Snowflake today, interested in real-time ML). They struggle with demand forecasting accuracy across 2,000+ stores.",
                    )
                  }
                  className="italic hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-primary/20 hover:decoration-primary/40"
                >
                  "Build a demo for Acme Corp, a Fortune 500 retailer struggling
                  with demand forecasting across 2,000+ stores..."
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Three paths: Browse, Create, Manage */}
        <div className="relative z-10 mx-auto mt-10 w-full max-w-3xl grid grid-cols-3 gap-3">
          <Link
            to="/library"
                        className="group rounded-xl border border-violet-500/15 bg-violet-500/[0.04] hover:bg-violet-500/[0.08] hover:border-violet-500/30 p-4 transition-all text-left"
          >
            <Layers className="h-5 w-5 text-violet-400 mb-2" />
            <p className="text-sm font-medium">Browse Collections</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Pre-built block assemblies ready to generate
            </p>
          </Link>
          <Link
            to="/library"
                        className="group rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08] hover:border-emerald-500/30 p-4 transition-all text-left"
          >
            <Blocks className="h-5 w-5 text-emerald-400 mb-2" />
            <p className="text-sm font-medium">Browse Blocks</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Explore structured context for domains, patterns, and capabilities
            </p>
          </Link>
          <Link
            to="/library"
                        className="group rounded-xl border border-blue-500/15 bg-blue-500/[0.04] hover:bg-blue-500/[0.08] hover:border-blue-500/30 p-4 transition-all text-left"
          >
            <Library className="h-5 w-5 text-blue-400 mb-2" />
            <p className="text-sm font-medium">Template Library</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Fork vetted demo packages and customize
            </p>
          </Link>
        </div>

        {/* Collections grid */}
        {collections.length > 0 && (
          <div className="relative z-10 mx-auto mt-12 w-full max-w-5xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Collections
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Each collection is a set of context blocks that generate a complete demo
                </p>
              </div>
              <Link to="/library" search={{ tab: "collections" }}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Layers className="h-3 w-3" />
                  Create Collection
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {collections.map((collection) => (
                <button
                  key={collection.slug}
                  onClick={() =>
                    navigate({
                      to: "/workspace",
                      search: {
                        topic: "",
                        generationId: undefined,
                        collection: collection.slug,
                      },
                    })
                  }
                  className="group flex flex-col rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 text-left transition-all hover:border-primary/30 hover:bg-card/80"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {collection.name}
                    </span>
                  </div>
                  <span className="inline-flex w-fit rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary mb-2">
                    {collection.industry}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 flex-1">
                    {collection.description}
                  </p>
                  <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
                    <span>{collection.block_slugs.length} blocks</span>
                    <span>{collection.output_file_count} outputs</span>
                    <ArrowRight className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="h-12" />
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />
    </div>
  );
}
